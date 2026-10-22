#!/usr/bin/env node
/**
 * Creates (or promotes) the first administrator account.
 *
 *   npm run admin:create -- --email=you@example.com --name="Your Name"
 *
 * Why this exists
 * ---------------
 * `npm run db:seed` must NOT be run against a hosted database: it creates demo
 * students plus an admin whose password is published in the README. A real
 * deployment therefore needs a way to create its own administrator. There is
 * deliberately still no HTTP endpoint that can grant the admin role, so the only
 * routes to administrator are this script and direct SQL.
 *
 * Password input
 * --------------
 * Read from (in order of precedence):
 *   1. `ADMIN_PASSWORD` environment variable (for automation)
 *   2. an interactive prompt with echo disabled
 * A password passed as `--password=` would leak into shell history, so it is
 * deliberately not supported.
 *
 * Behaviour
 * ---------
 *   * email does not exist -> creates an active administrator
 *   * email exists as a student -> refuses, unless `--promote` is given
 *   * email exists as an admin -> reports it and changes nothing
 */
import readline from 'node:readline';
import { query, withTransaction, closePool } from '../config/db.js';
import { hashPassword, isPasswordAcceptable, PASSWORD_POLICY } from '../utils/password.js';
import { describeConnection } from '../../../database/scripts/lib/env.js';
import config from '../config/env.js';
import * as auditService from '../services/audit.service.js';

function parseArgs(argv) {
  const flags = new Set();
  const options = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    const value = rest.join('=');
    if (value === '') flags.add(key);
    else options[key] = value;
  }
  return { flags, options };
}

/** Reads a line from the terminal without echoing it. */
function promptHidden(label) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      // Not a terminal (CI, piped input): fall back to a plain read so the
      // script can still work, and say so.
      const rl = readline.createInterface({ input: stdin, output: stdout });
      rl.question(label, (answer) => {
        rl.close();
        resolve(answer);
      });
      return;
    }

    stdout.write(label);
    let value = '';
    stdin.resume();
    stdin.setRawMode(true);

    const finish = (result) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      resolve(result);
    };

    const onData = (buffer) => {
      for (const char of buffer.toString('utf8')) {
        if (char === '\r' || char === '\n') {
          finish(value);
          return;
        }
        if (char === '\u0003') {
          // Ctrl+C
          stdin.setRawMode(false);
          stdout.write('\n');
          process.exit(130);
        }
        if (char === '\u007f' || char === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write('\b \b');
          }
          continue;
        }
        value += char;
        stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

async function readPassword() {
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;

  const first = await promptHidden('Password: ');
  if (!isPasswordAcceptable(first)) {
    throw new Error(`Password must be ${PASSWORD_POLICY.description} (${PASSWORD_POLICY.minLength}-${PASSWORD_POLICY.maxLength} characters).`);
  }
  const second = await promptHidden('Confirm password: ');
  if (first !== second) throw new Error('The two passwords do not match.');
  return first;
}

async function main() {
  const { flags, options } = parseArgs(process.argv.slice(2));
  const email = (options.email ?? '').trim().toLowerCase();

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('Provide a valid email: --email=you@example.com');
  }

  const fullName = (options.name ?? email.split('@')[0]).trim();
  if (fullName.length < 2 || fullName.length > 120) {
    throw new Error('Provide a name between 2 and 120 characters: --name="Your Name"');
  }

  console.log(`Target database: ${describeConnection(config.databaseUrl)}`);

  const existing = await query(
    `SELECT user_id, email, role, is_active FROM users WHERE email = $1`,
    [email]
  );

  if (existing.rows.length > 0) {
    const user = existing.rows[0];

    if (user.role === 'admin') {
      console.log(`\n${email} is already an administrator (user_id=${user.user_id}). Nothing to do.`);
      return;
    }
    if (!flags.has('promote')) {
      throw new Error(
        `An account with ${email} already exists as a "${user.role}". ` +
          'Re-run with --promote to grant administrator rights (the password is not changed).'
      );
    }

    await withTransaction(async (client) => {
      await client.query(`UPDATE users SET role = 'admin', is_active = TRUE WHERE user_id = $1`, [user.user_id]);
      await auditService.record(
        {
          actorUserId: null, // performed out-of-band by an operator
          action: auditService.AUDIT_ACTIONS.USER_ROLE_GRANTED,
          entityType: 'user',
          entityId: user.user_id,
          metadata: { email, from: user.role, to: 'admin', method: 'admin:create --promote' },
        },
        client
      );
    });

    console.log(`\nPromoted ${email} to administrator (user_id=${user.user_id}). Password unchanged.`);
    return;
  }

  const password = await readPassword();
  if (!isPasswordAcceptable(password)) {
    throw new Error(`Password must be ${PASSWORD_POLICY.description} (${PASSWORD_POLICY.minLength}-${PASSWORD_POLICY.maxLength} characters).`);
  }

  const passwordHash = await hashPassword(password);

  const created = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users (full_name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'admin', TRUE)
       RETURNING user_id, email, role`,
      [fullName, email, passwordHash]
    );

    await auditService.record(
      {
        actorUserId: null,
        action: auditService.AUDIT_ACTIONS.USER_ROLE_GRANTED,
        entityType: 'user',
        entityId: rows[0].user_id,
        metadata: { email, from: null, to: 'admin', method: 'admin:create' },
      },
      client
    );

    return rows[0];
  });

  console.log(`\nCreated administrator ${created.email} (user_id=${created.user_id}).`);
  console.log('Sign in with the password you just entered. It was hashed with bcrypt and never stored in plain text.');
}

main()
  .catch((error) => {
    console.error(`\nCould not create the administrator: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });

/**
 * Image upload handling (FR-09, spec 16 "Treat uploads as untrusted input").
 *
 * Defence layers:
 *   1. multer rejects anything above MAX_UPLOAD_MB before it is written.
 *   2. the declared MIME type must be an allowed raster image type;
 *   3. the stored filename is generated with randomUUID() — the client filename
 *      is never used, so path traversal and extension tricks are impossible;
 *   4. the first bytes of the stored file are checked against the real magic
 *      numbers, so a renamed .exe cannot masquerade as a .png;
 *   5. files are stored outside the source tree and served statically with
 *      `Content-Disposition: inline` and a restrictive CSP-friendly header, so
 *      they can never execute.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import config from '../config/env.js';
import { badRequest, payloadTooLarge } from '../utils/httpError.js';

const ALLOWED_MIME_TYPES = Object.freeze({
  'image/jpeg': { extension: 'jpg', magic: [[0xff, 0xd8, 0xff]] },
  'image/png': { extension: 'png', magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  'image/webp': { extension: 'webp', magic: [['RIFF']], offset: 8, magicAt: [[0x57, 0x45, 0x42, 0x50]] },
});

fs.mkdirSync(config.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    const descriptor = ALLOWED_MIME_TYPES[file.mimetype];
    const extension = descriptor ? descriptor.extension : 'bin';
    cb(null, `${crypto.randomUUID()}.${extension}`);
  },
});

function fileFilter(_req, file, cb) {
  if (!ALLOWED_MIME_TYPES[file.mimetype]) {
    cb(badRequest('Only JPEG, PNG and WebP images are accepted.', { received: file.mimetype }));
    return;
  }
  cb(null, true);
}

export const uploadImage = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.maxUploadBytes,
    files: 1,
  },
}).single('image');

/** Reads the file header and confirms it matches a supported image format. */
function detectImageMime(filePath) {
  const header = Buffer.alloc(16);
  const descriptor = fs.openSync(filePath, 'r');
  try {
    fs.readSync(descriptor, header, 0, 16, 0);
  } finally {
    fs.closeSync(descriptor);
  }

  for (const [mime, spec] of Object.entries(ALLOWED_MIME_TYPES)) {
    const matchesFirst = spec.magic.some((signature) =>
      signature.every((byte, index) => header[index] === byte)
    );
    if (!matchesFirst) continue;

    if (spec.magicAt) {
      const matchesSecond = spec.magicAt.some((signature) =>
        signature.every((byte, index) => header[(spec.offset ?? 0) + index] === byte)
      );
      if (!matchesSecond) continue;
    }
    return mime;
  }
  return null;
}

/**
 * Wraps `uploadImage` so that a rejected or spoofed file is deleted from disk
 * and reported as a 400/413 instead of leaking a multer error.
 */
export function handleImageUpload(req, res, next) {
  uploadImage(req, res, (error) => {
    if (error) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(payloadTooLarge(`Uploads are limited to ${config.maxUploadMb} MB.`));
      }
      return next(error);
    }

    if (!req.file) return next();

    const detected = detectImageMime(req.file.path);
    if (!detected || detected !== req.file.mimetype) {
      fs.rm(req.file.path, { force: true }, () => {});
      return next(
        badRequest('The uploaded file is not a valid JPEG, PNG or WebP image.', {
          declared: req.file.mimetype,
          detected,
        })
      );
    }

    req.file.detectedMimeType = detected;
    return next();
  });
}

/** Removes a stored file, ignoring "already gone" errors. */
export function removeStoredFile(storageKey) {
  const absolute = path.join(config.uploadDir, path.basename(storageKey));
  fs.rm(absolute, { force: true }, () => {});
}

export { ALLOWED_MIME_TYPES };
export default { handleImageUpload, uploadImage, removeStoredFile, ALLOWED_MIME_TYPES };

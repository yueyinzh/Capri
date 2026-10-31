# Third-party tools

## yt-dlp

- Project: https://github.com/yt-dlp/yt-dlp
- License: Unlicense
- Installed location: `tools/bin/<platform>-<arch>/yt-dlp`
- Installation method: official GitHub release through `npm run setup:video-tools`
- Integrity: the setup script verifies the SHA-256 digest supplied by the GitHub Releases API before writing the executable.

The bundled Windows executable and its version are recorded in
`tools/bin/win32-x64/manifest.json`.

## FFmpeg

- Project: https://ffmpeg.org/
- Distribution: npm package `@ffmpeg-installer/ffmpeg`
- Purpose: merge separate video and audio streams and produce the final media file.

Users must comply with the licenses of these tools, the target website's terms
of service, and applicable copyright law.

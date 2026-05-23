# LAN Share

Share files and folders over your local network. Multiple users can browse and download simultaneously.

## Quick Start

```bash
npm install
npm start
```

Then open your browser at `http://localhost:3000`

## Features

- 📁 Browse files and folders with a clean UI
- ⬇️  Download files or entire folders (auto-zipped)
- ⬆️  Upload files via drag & drop or file picker
- ☑️  Multi-select for batch download or delete
- 🔍 Search files in the current directory
- 📱 QR code for easy mobile access
- 🔒 Path traversal protection

## Configuration

| Variable     | Default           | Description                        |
|--------------|-------------------|------------------------------------|
| `PORT`       | `3000`            | Server port                        |
| `SHARE_DIR`  | `./shared`        | Directory to share                 |

### Custom share directory
```bash
SHARE_DIR=/path/to/your/files npm start
```

### Custom port
```bash
PORT=8080 npm start
```

## Usage

1. Run the server on any computer on your LAN
2. Share the URL shown in the terminal (e.g. `http://192.168.1.10:3000`)
3. Anyone on the same network can open it in their browser
4. Click the QR icon in the top right for a scannable code

## Notes

- Folders are downloaded as `.zip` archives
- Multi-file selection: hold Ctrl/Cmd and click, or click the checkbox area
- Drag & drop files onto the browser window to upload

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPngBuffer(width, height, r, g, b) {
    const rawData = [];
    for (let y = 0; y < height; y++) {
        rawData.push(0); // Filter type 0 (None)
        for (let x = 0; x < width; x++) {
            rawData.push(r, g, b, 255); // RGBA
        }
    }

    const compressed = zlib.deflateSync(Buffer.from(rawData));

    // PNG signature
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR chunk
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // Bit depth
    ihdr[9] = 6; // Color type (RGBA)
    ihdr[10] = 0; // Compression
    ihdr[11] = 0; // Filter
    ihdr[12] = 0; // Interlace
    const ihdrChunk = makeChunk('IHDR', ihdr);

    // IDAT chunk
    const idatChunk = makeChunk('IDAT', compressed);

    // IEND chunk
    const iendChunk = makeChunk('IEND', Buffer.alloc(0));

    return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const crcCalc = crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeUInt32BE(crcCalc, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc ^= buf[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

const targetImages = [
    'hardware/circuit/circuit_diagram.png',
    'docs/architecture.png',
    'docs/flowchart.png',
    'docs/circuit.png',
    'presentation/screenshots/dashboard_preview.png',
    'web/assets/images/banner.png',
    'web/assets/logo/logo.png'
];

targetImages.forEach(relPath => {
    const fullPath = path.join(__dirname, '..', relPath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const pngBuf = createPngBuffer(400, 250, 15, 29, 48); // Dark Navy color matching theme
    fs.writeFileSync(fullPath, pngBuf);
    console.log('Created placeholder image:', relPath);
});

const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const excelPath = path.join(__dirname, 'Aashika_Bhaweneshwor Stock Book.xlsx');

const workbook = xlsx.readFile(excelPath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(sheet);

// Find matching image file for each product
const allFiles = fs.readdirSync(__dirname);
const imageFiles = allFiles.filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));

function normalize(str) {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const products = rows.map((row, index) => {
    const name = row['Product'];
    const volume = row['Quantaty per bottle'];
    const piecesPerCase = row['Quantaty Per Case'];
    const fullName = `${name} ${volume}`;
    const normFull = normalize(fullName);

    let imageFile = null;
    for (const file of imageFiles) {
        const ext = path.extname(file);
        const base = path.basename(file, ext);
        if (normalize(base) === normFull) {
            imageFile = file;
            break;
        }
    }

    // Initial stock set to 0
    const stockCases = 0;
    const stockPieces = 0;

    return {
        id: `prod_${index + 1}`,
        name: name,
        volume: volume,
        piecesPerCase: piecesPerCase,
        image: imageFile || '',
        initialStockCases: stockCases,
        initialStockPieces: stockPieces
    };
});

const output = `// Auto-generated product catalog from Excel
// Generated: ${new Date().toISOString()}
const PRODUCT_CATALOG = ${JSON.stringify(products, null, 2)};

// Allow Node (server.js) to use the same catalog as the single source of truth.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PRODUCT_CATALOG;
}
`;

fs.writeFileSync(path.join(__dirname, 'data.js'), output, 'utf-8');
console.log(`Generated data.js with ${products.length} products.`);
products.forEach(p => {
    console.log(`  ${p.name} ${p.volume} -> ${p.image || 'NO IMAGE'} | Stock: ${p.initialStockCases} cases + ${p.initialStockPieces} pcs`);
});

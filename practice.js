// Launches the SAME system but with the practice quiz and a separate database,
// so practice attempts never touch your real exam data.
const path = require('path');
process.env.EXAM_FILE = process.env.EXAM_FILE || path.join(__dirname, 'config', 'practice.json');
process.env.DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'practice.db');
require('./server.js');

const sqlite3 = require('sqlite3').verbose(); // Import sqlite3
const path = require('path');
const fs = require('fs');

// Ensure the data folder exists
const dataFolderPath = path.resolve(__dirname, '../database');
if (!fs.existsSync(dataFolderPath)) {
    fs.mkdirSync(dataFolderPath);
}

// Correct paths
const dbPath = path.resolve(dataFolderPath, 'database.sqlite'); // Ensure database.sqlite is in the data folder
const initSqlPath = path.resolve(dataFolderPath, 'database.sql'); // Ensure database.sql is in the data folder

// Default SQL commands to use when no database.sql exists
const sqlCommands = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    fb_id TEXT UNIQUE
);`;

// Only create a new database.sql if one doesn't already exist. Do not overwrite an existing file.
if (!fs.existsSync(initSqlPath)) {
    fs.writeFileSync(initSqlPath, sqlCommands.trim(), 'utf8');
    console.log('Created default database.sql');
} else {
    console.log('Found existing database.sql — leaving it intact.');
}

async function initializeDatabase() {
    return new Promise((resolve, reject) => {
        // Check if the database file already exists
        const dbExists = fs.existsSync(dbPath);

        // Open the database connection
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error(`Failed to connect to database: ${err.message}`);
                db.close();
                return reject(err);
            }
            console.log('Connected to the SQLite database.');

            // If the database file does not exist, initialize it
            if (!dbExists) {
                // Create an empty database file
                // fs.writeFileSync(dbPath, '');

                fs.readFile(initSqlPath, 'utf8', (err, data) => {
                    if (err) {
                        console.error(`Failed to read database.sql: ${err.message}`);
                        db.close();
                        return reject(err);
                    }

                    console.log('SQL commands from database.sql:', data); // Log the SQL commands

                    // Execute the SQL commands from the database.sql file
                    db.exec(data, (err) => {
                        if (err) {
                            console.error(`Failed to initialize database schema: ${err.message}`);
                            db.close();
                            return reject(new Error(`Database initialization failed: ${err.message}`));
                        }
                        resolve(db);
                    });
                });
            } else {
                resolve(db);
            }
        });
    });
}

// Call the function and log errors if any
initializeDatabase().catch((err) => {
    console.error('Error initializing database:', err);
});

module.exports = initializeDatabase;
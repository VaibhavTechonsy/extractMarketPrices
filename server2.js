import express from "express";
import fs from "fs";
import cors from "cors";
import path from "path";
import hsnwise_export from "./hsnToCountries.js";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve()));

app.post("/scrape/:hsCode/:country", async (req, res) => {
    const { hsCode, country } = req.params;
    const operationId = `${hsCode}-${Date.now()}`;

    try {
        const output = await hsnwise_export(hsCode, country);
        res.json({ 
            message: "Scraping completed", 
            output,
            operationId 
        });
    } catch (error) {
        res.status(500).json({ error: `Scraping failed: ${error.message}` });
    }
});

app.get("/countries", (req, res) => {
    fs.readFile("countries.json", "utf8", (err, data) => {
        if (err) {
            return res.status(500).json({ error: "File not found" });
        }
        try {
            const jsonData = JSON.parse(data);
            res.json(jsonData);
        } catch (parseError) {
            res.status(500).json({ error: "Invalid JSON format" });
        }
    });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
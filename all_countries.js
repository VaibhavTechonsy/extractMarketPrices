import puppeteer from 'puppeteer';
import fs from 'fs';

async function coutrywise_export() {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.setDefaultNavigationTimeout(30000);
    await page.goto('https://tradestat.commerce.gov.in/eidb/ecntcomq.asp');
    const jsonData = JSON.parse(fs.readFileSync('countries.json', 'utf8'));

    for (let item of jsonData) {
        let value = item.value;
        let countryData = {
            "Country": "",
            "HSData": {}
        };

        for (let j = 2; j <= 8; j = j + 2) {
            for (let i = 2021; i <= 2024; i++) {
                await new Promise(resolve => setTimeout(resolve, 5000)); 

                await page.select('#select2', i.toString());
                await page.select('#select3', value);
                await page.select('#hslevel', j.toString());
                await page.click('#radioDAll');
                await page.click('#button1');

                await new Promise(resolve => setTimeout(resolve, 10000));

                await page.waitForSelector('table');

                const countryRegion = await page.evaluate(() => {
                    const fontElements = Array.from(document.querySelectorAll('font'));
                    const countryFont = fontElements.find(font => font.innerText.includes('Country / Region:'));
                    return countryFont ? countryFont.innerText.replace('Country / Region:', '').trim() : 'Unknown';
                });

                if (!countryData.Country) {
                    countryData.Country = countryRegion;
                }

                const tableData = await page.evaluate(() => {
                    const table = document.querySelector('table');
                    if (!table) return [];

                    const headers = Array.from(table.querySelectorAll('th')).map(header => header.innerText.trim());

                    const rows = Array.from(table.querySelectorAll('tbody tr')).map(row => {
                        const cells = Array.from(row.querySelectorAll('td')).map(cell => cell.innerText.trim());
                        return headers.reduce((obj, header, index) => {
                            let value = cells[index] || '';

                            obj[header] = value;
                            return obj;

                        }, {});
                    });

                    return rows;
                });

                const extraFields = ["S.No.", "%Growth"];
                let cleanedTableData = tableData.map(obj => {
                    extraFields.forEach(field => delete obj[field]);
                    return obj;
                });

                // Initialize HS level data if not exists
                if (!countryData.HSData[j]) {
                    countryData.HSData[j] = {};
                }

                // Process each item and merge by HSCode
                cleanedTableData.forEach(item => {
                    const hscode = item.HSCode;
                    const year = i.toString();
                    const prevYear = (i - 1).toString();
                    const yearKey = `${prevYear}-${year}`;
                    const nextYearKey = `${year}-${(i + 1).toString()}`;

                    if (!countryData.HSData[j][hscode]) {
                        // Create new entry for this HSCode
                        countryData.HSData[j][hscode] = {
                            HSCode: hscode,
                            Commodity: item.Commodity
                        };
                    }

                    // Add the year data
                    if (item[yearKey]) {
                        countryData.HSData[j][hscode][yearKey] = item[yearKey];
                    }
                    if (item[nextYearKey]) {
                        countryData.HSData[j][hscode][nextYearKey] = item[nextYearKey];
                    }
                });

                console.log(`Extracted Data for ${countryRegion} (${i}, HS${j})`);

                await page.goto('https://tradestat.commerce.gov.in/eidb/ecntcomq.asp');
            }
        }

        for (let hsLevel in countryData.HSData) {
            countryData.HSData[hsLevel] = Object.values(countryData.HSData[hsLevel]);
        }

        if (countryData.Country) {
            const safeCountryName = countryData.Country.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
            const filePath = `data/${safeCountryName}.json`;
            
            // Check if file exists and merge data if needed
            if (fs.existsSync(filePath)) {
                const existingData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                // Merge HS levels
                for (const [hsLevel, data] of Object.entries(countryData.HSData)) {
                    if (existingData.HSData[hsLevel]) {
                        // Create a map of existing HSCodes for quick lookup
                        const existingMap = {};
                        existingData.HSData[hsLevel].forEach(item => {
                            existingMap[item.HSCode] = item;
                        });

                        // Merge new data
                        data.forEach(newItem => {
                            if (existingMap[newItem.HSCode]) {
                                // Merge year data
                                for (const [yearKey, value] of Object.entries(newItem)) {
                                    if (yearKey !== 'HSCode' && yearKey !== 'Commodity') {
                                        existingMap[newItem.HSCode][yearKey] = value;
                                    }
                                }
                            } else {
                                existingData.HSData[hsLevel].push(newItem);
                            }
                        });
                    } else {
                        existingData.HSData[hsLevel] = data;
                    }
                }
                fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2));
            } else {
                fs.writeFileSync(filePath, JSON.stringify(countryData, null, 2));
            }
            
            console.log(`All HS data saved to ${filePath}`);
        }
    }
    await browser.close();
}

coutrywise_export();
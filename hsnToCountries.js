import puppeteer from 'puppeteer';
import fs from 'fs';

async function hsnwise_export(hsCode, selectedCountry = null) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.setDefaultNavigationTimeout(30000);
    await page.goto('https://tradestat.commerce.gov.in/eidb/ecomcntq.asp');
    const hsn = hsCode.toString();

    for (let i = 2021; i < 2025; i++) {
        console.log(`${i} started`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        await page.select('#select2', i.toString());
        await page.click('input[name="hscode"]');
        await page.type('input[name="hscode"]', hsn, { delay: 100 });
        await page.click('#button1');
        await new Promise(resolve => setTimeout(resolve, 10000));

        await page.waitForSelector('table');

        const tableData = await page.evaluate(() => {
            const tables = document.querySelectorAll('table');
            if (tables.length < 2) return [];

            const secondTable = tables[1];
            const rows = secondTable.querySelectorAll('tr');

            let headers = [];
            let jsonData = [];

            rows.forEach((row, rowIndex) => {
                const columns = row.querySelectorAll('td, th');
                const rowData = Array.from(columns).map(col => col.innerText.trim());

                if (rowIndex === 0) {
                    headers = rowData;
                } else {
                    let obj = {};
                    rowData.forEach((cell, index) => {
                        if (index === 1) {
                            obj["country"] = cell;
                        } else if (index === 2 || index === 3 && headers[index]) {
                            obj[headers[index]] = cell;
                        }
                    });
                    if (Object.keys(obj).length > 0) jsonData.push(obj);
                }
            });

            return jsonData;
        });

        let newData = {
            "hsncode": hsn,
            "TableData": tableData
        };

        const filePath = `data/${hsn}.json`;
        let oldData = { "TableData": [] };

        if (fs.existsSync(filePath)) {
            oldData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }

        let updatedData = oldData.TableData ? [...oldData.TableData] : [];

        if (Array.isArray(newData.TableData)) {
            newData.TableData.forEach(newItem => {
                const existingItem = updatedData.find(item => item.country === newItem.country);

                if (existingItem) {
                    Object.keys(newItem).forEach(key => {
                        if (!(key in existingItem)) {
                            existingItem[key] = newItem[key];
                        }
                    });
                } else {
                    updatedData.push(newItem);
                }
            });
        }

        let finalData = {
            "hsncode": hsn,
            "TableData": updatedData
        };

        fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
        await page.goto('https://tradestat.commerce.gov.in/eidb/ecomcntq.asp');
    }

    await browser.close();
    return generateOutput(hsn, selectedCountry);
}

function generateOutput(hsn, selectedCountry = null) {
    const filePath = `data/${hsn}.json`;
    if (!fs.existsSync(filePath)) {
        return {
            message: "Data file not found!",
            output: ""
        };
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    const validCountries = data.TableData.filter(item => {
        return item.country && item.country !== "Total" && !/^[\d,.]+$/.test(item.country);
    });

    const countriesWithTotals = validCountries.map(countryData => {
        let total = 0;
        for (const key in countryData) {
            if (key !== "country") {
                const value = countryData[key] === "" ? 0 : 
                             parseFloat(countryData[key].replace(/,/g, '')) || 0;
                total += value;
            }
        }
        return {
            country: countryData.country.trim(),
            total: total
        };
    });

    countriesWithTotals.sort((a, b) => b.total - a.total);
    let topCountries = countriesWithTotals.slice(0, 10);

    if (selectedCountry) {
        selectedCountry = selectedCountry.trim().toUpperCase();
        const isInTop10 = topCountries.some(c => 
            c.country.toUpperCase() === selectedCountry
        );
        
        if (!isInTop10) {
            const selectedCountryData = countriesWithTotals.find(c => 
                c.country.toUpperCase().includes(selectedCountry) ||
                selectedCountry.includes(c.country.toUpperCase())
            );
            if (selectedCountryData) {
                topCountries[9] = selectedCountryData;
            } else {
                console.log(`Country ${selectedCountry} not found in data`);
            }
        }
    }

    let output = "";

    topCountries.forEach((country) => {
        const formattedTotal = country.total.toLocaleString('en-IN', {
            maximumFractionDigits: 2,
            minimumFractionDigits: 2
        });
        output += `${country.country.padEnd(18)} | ${formattedTotal.padStart(10)} |`;
    });

    return {
        message: "Scraping completed",
        output: output,
        operationId: `${hsn}-${Date.now()}`
    };
}

export default hsnwise_export;
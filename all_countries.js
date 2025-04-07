import puppeteer from 'puppeteer';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Helper function to normalize country names for comparison
function normalizeCountryName(countryName) {
    return countryName.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

// Function to validate HSN code (must be numeric without dots and not just zeros)
function isValidHsnCode(hscode) {
    return typeof hscode === 'string' &&
           /^\d+$/.test(hscode) &&
           hscode !== '' &&
           !/^0+$/.test(hscode); // Reject if it's all zeros
}

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

                if (!countryData.HSData[j]) {
                    countryData.HSData[j] = {};
                }

                cleanedTableData.forEach(item => {
                    const hscode = item.HSCode;
                    const year = i.toString();
                    
                    if (!countryData.HSData[j][hscode]) {
                        countryData.HSData[j][hscode] = {
                            HSCode: hscode,
                            Commodity: item.Commodity
                        };
                    }

                    // Add all available data from the row
                    for (const [key, value] of Object.entries(item)) {
                        if (key !== 'HSCode' && key !== 'Commodity' && value) {
                            countryData.HSData[j][hscode][key] = value;
                        }
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
            
            if (fs.existsSync(filePath)) {
                const existingData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                for (const [hsLevel, data] of Object.entries(countryData.HSData)) {
                    if (existingData.HSData[hsLevel]) {
                        const existingMap = {};
                        existingData.HSData[hsLevel].forEach(item => {
                            existingMap[item.HSCode] = item;
                        });

                        data.forEach(newItem => {
                            if (existingMap[newItem.HSCode]) {
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

            // Now upload to Supabase
            const normalizedCountryName = normalizeCountryName(countryData.Country);
            
            // Process each HS level
            for (const hsLevel in countryData.HSData) {
                for (const item of countryData.HSData[hsLevel]) {
                    const hscode = item.HSCode;
                    
                    // Skip if HSN code is invalid
                    if (!isValidHsnCode(hscode)) {
                        console.log(`Skipping invalid HSN code: ${hscode}`);
                        continue;
                    }

                    // Create the data object without HSCode and Commodity
                    const countryDataJson = {};
                    for (const [key, value] of Object.entries(item)) {
                        if (key !== 'HSCode' && key !== 'Commodity' && value) {
                            countryDataJson[key] = value;
                        }
                    }

                    try {
                        // Check if the HSN code exists
                        const { data: existingRecord, error: fetchError } = await supabase
                            .from('market_prices')
                            .select('*')
                            .eq('hsn_code', hscode) // Store as string to preserve format
                            .single();

                        if (fetchError && fetchError.code !== 'PGRST116') { // Ignore "No rows found" error
                            throw fetchError;
                        }

                        if (existingRecord) {
                            // Update existing record - only the specific country column
                            const { error: updateError } = await supabase
                                .from('market_prices')
                                .update({ 
                                    [normalizedCountryName]: countryDataJson 
                                })
                                .eq('hsn_code', hscode); // Keep as string

                            if (updateError) throw updateError;
                            console.log(`Updated record for HSN ${hscode} with data for ${countryData.Country}`);
                        } else {
                            // Insert new record with hsn_code and country data
                            const { error: insertError } = await supabase
                                .from('market_prices')
                                .insert({ 
                                    hsn_code: hscode, // Store as string to preserve leading zeros
                                    [normalizedCountryName]: countryDataJson 
                                });

                            if (insertError) throw insertError;
                            console.log(`Created new record for HSN ${hscode} with data for ${countryData.Country}`);
                        }
                    } catch (error) {
                        console.error(`Error processing HSN ${hscode} for ${countryData.Country}:`, error);
                    }
                }
            }
        }
    }
    await browser.close();
}

coutrywise_export();
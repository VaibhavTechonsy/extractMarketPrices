import { serve } from "https://deno.land/std@0.114.0/http/server.ts";
import mendablefirecrawlJs from 'https://cdn.jsdelivr.net/npm/@mendable/firecrawl-js@1.14.0/+esm';

const app = new mendablefirecrawlJs({apiKey: "fc-83afcf9b631043849570c71940f90dfe"});

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS, POST",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
  };

async function hsnwise_export() {
    var hsn = "69";

    for (let i = 2021; i < 2025; i++) {
        console.log(i, "started :");
        try {
            const crawlResponse = await app.scrapeUrl(
                `https://tradestat.commerce.gov.in/eidb/ecomcntq.asp`,
                {   
                    formats: ["html"], 
                    actions: [
                        { type: "wait", milliseconds: 5000 },
    
                        { type: "click", selector: "#select2" },
                        { type: "wait", milliseconds: 2000 },
    
                        { type: "click", selector: `#select2 option[value='${i}']` }
                        { type: "wait", milliseconds: 2000 },
    
                        { type: "click", selector: 'input[name="hscode"]' },
                        { type: "write", selector: 'input[name="hscode"]', text: hsn },

                        { type: "wait", milliseconds: 2000 },
    
                        { type: "click", selector: "#button1" },
                        { type: "wait", milliseconds: 5000 }
                    ],
                }
            );
    
            console.log(`${i} completed successfully.`);
            console.log(crawlResponse);
            
            // Extract table data using evaluate
            const tableData = await app.evaluate(() => {
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
                            } else if ((index === 2 || index === 3) && headers[index]) {
                                obj[headers[index]] = cell;
                            }
                        });
                        if (Object.keys(obj).length > 0) jsonData.push(obj);
                    }
                });
            
                return jsonData;
            });
            
        } catch (error) {
            console.error(`Error processing year ${i}:`, error);
        }
    }
    
    console.log('Completed!');
}

serve(async (req) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
  
    if (req.method === "GET") {
      try {
  
        const existingData = await hsnwise_export();
        if (existingData) {
          return new Response(
            JSON.stringify({
              data: existingData,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch (error : any) {
        return new Response(error.message, { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
  
    return new Response("Method not allowed", { status: 405 });
  });
  
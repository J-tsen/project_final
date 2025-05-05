// Polyfill for cross-browser compatibility
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// Listen for a click on the extension icon
function runAdBlocker(tabId) {
    // Get the tab by ID
    browserAPI.tabs.get(tabId, async function(tab) {
        if (!tab) {
            console.error('Tab not found');
            return;
        }
        
        // Execute script to get scroll position
        let scroll;
        try {
            //Chrome/Edge scripting API
            if (browserAPI.scripting) {
                scroll = await browserAPI.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => ({ scrollX: window.scrollX, scrollY: window.scrollY })
                });
            } else {
                //Firefox API
                scroll = await browserAPI.tabs.executeScript(tab.id, {
                    code: "({scrollX: window.scrollX, scrollY: window.scrollY})"
                });
            }
            console.log('Scroll position:', scroll[0].result || scroll[0]);
        } catch (error) {
            console.error('Error getting scroll position:', error);
            // Provide a default in case of error
            scroll = [{result: {scrollX: 0, scrollY: 0}}];
        }
        
        // Capture the visible area of the tab as a PNG image (data URL)
        const captureFunction = browserAPI.tabs.captureVisibleTab || browserAPI.tabs.captureTab;
        captureFunction(tab.windowId, { format: "png" }, async function (screenshot) {
          if (browserAPI.runtime.lastError) {
            console.error("Error capturing tab:", browserAPI.runtime.lastError);
            return;
          }
          const base64Data = screenshot.split(",")[1];
          
          try {
            const response = await fetch("http://localhost:3000/proxy", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ image: base64Data }),
              mode: "cors",
            });
    
            const result = await response.json();
            console.log("Full server response:", result);
    
            // Handle Roboflow predictions
            if (result.roboflowResult?.outputs?.[0]?.predictions?.predictions) {
              const predictions = result.roboflowResult.outputs[0].predictions.predictions;
              
              // Send predictions to content script of the specified tab
              try {
                // Check if we can inject content scripts in this tab
                if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || 
                    tab.url.startsWith('about:') || tab.url.startsWith('extension://')) {
                  console.log('Cannot inject content script into browser pages');
                  return;
                }

                // Ensure content script is loaded before sending message
                if (browserAPI.scripting) {
                    // Chrome/Edge approach
                    await browserAPI.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['contentV3.js']
                    });
                } else {
                    // Firefox approach
                    await browserAPI.tabs.executeScript(tab.id, {
                        file: 'contentV3.js'
                    });
                }
                
                await browserAPI.tabs.sendMessage(tab.id, {
                    type: 'FIND_ELEMENTS',
                    predictions: predictions,
                    decision: result.decision,
                    scroll: scroll[0].result || scroll[0]
                });
              } catch (error) {
                console.error('Error:', error);
              }

              predictions.forEach((prediction, index) => {
                console.log(`Prediction ${index + 1}:`);
                console.log(`Class: ${prediction.class}`);
                console.log(`Confidence: ${prediction.confidence}`);
                console.log(`Bounding Box: x=${prediction.x}, y=${prediction.y}, width=${prediction.width}, height=${prediction.height}`);
              });
            } else {
              console.log("No Roboflow predictions found");
            }
    
            // Handle Model 1 (OCR) results
            if (result.roboflowResult?.outputs?.[0]?.model_1) {
              console.log("\nRoboflow OCR Results (model_1):");
              result.roboflowResult.outputs[0].model_1.forEach((text, index) => {
                console.log(`Text ${index + 1}: "${text}"`);
              });
            } else {
              console.log("No Model 1 (OCR) results found");
            }
    
            // Handle NLP results
            if (result.nlpResults && result.nlpResults.length > 0) {
              console.log("\nNLP Analysis Results:");
              result.nlpResults.forEach((nlpResult, index) => {
                console.log(`\nText ${index + 1}: "${nlpResult.text}"`);
                console.log(`Prediction: ${nlpResult.prediction}`);
                console.log(`Confidence Scores:`);
                console.log(`  Non-Ad: ${(nlpResult.confidence['Non-Ad'] * 100).toFixed(2)}%`);
                console.log(`  Ad: ${(nlpResult.confidence['Ad'] * 100).toFixed(2)}%`);
              });
            } else {
              console.log("No NLP results found");
            }
            console.log("Server Decision:", result.decision);
    
          } catch (error) {
            console.error("Error sending image to proxy:", error);
          }
        });
    });
  }

// Listen messages from the popup
browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "runAdBlocker") {
        runAdBlocker(request.tabId);
        sendResponse({status: "Ad Blocker executed"});
    }
});
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;
const exit = document.getElementById("close");
const analyze = document.getElementById("analyze");
const placeholderToggle = document.getElementById("placeholderToggle");

// When popup loads, get current state from storage
document.addEventListener('DOMContentLoaded', () => {
    // Retrieve the stored placeholder setting
    browserAPI.storage.local.get(['createPlaceholders'], function(result) {
        // Default to true if setting doesn't exist
        const createPlaceholders = result.createPlaceholders !== undefined ? result.createPlaceholders : true;
        // Update the toggle UI
        placeholderToggle.checked = createPlaceholders;
        console.log("Loaded placeholder setting:", createPlaceholders);
    });
});

// Handle analyze button click
if (analyze) {
    analyze.addEventListener("click", function() {
        // Get the current tab ID
        browserAPI.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs[0]) {
                browserAPI.runtime.sendMessage({ 
                    action: "runAdBlocker",
                    tabId: tabs[0].id 
                });
                console.log("running ad blocker: ", tabs[0].id);
            }
        });
    });
}

// Handle placeholder toggle changes
if (placeholderToggle) {
    placeholderToggle.addEventListener("change", function() {
        const createPlaceholders = placeholderToggle.checked;
        
        // Save setting to local storage
        browserAPI.storage.local.set({ createPlaceholders: createPlaceholders }, function() {
            console.log("Placeholder setting saved:", createPlaceholders);
        });
    });
}

if (exit){
    exit.addEventListener("click", function() {
        window.close();
        console.log("Close button clicked");
    });
}
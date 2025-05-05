function makeDecision(nlpAnalysisResults, roboflowResult) {
    try {
        // Ensure inputs are valid
        const nlpResults = Array.isArray(nlpAnalysisResults) ? nlpAnalysisResults : [];
        
        // Extract predictions from roboflowResult
        const imgResults = roboflowResult?.outputs?.[0]?.predictions?.predictions || [];

        console.log("Making decision with:", { 
            nlpResultsCount: nlpResults.length, 
            imgResultsCount: imgResults.length 
        });

        // Process each result pair
        const decisions = [];
        
        // Extract NLP results
        const processedNlpResults = nlpResults.map(result => {
            if (result.error) {
                console.warn("NLP Error:", result.error);
                return null;
            }
            return {
                text: result.text,
                prediction: result.prediction,
                adConfidence: result.confidence.Ad,
                nonAdConfidence: result.confidence['Non-Ad']
            };
        }).filter(result => result !== null);

        // Process Object Detection results
        const processedImgResults = imgResults.map(prediction => ({
            class: prediction.class,
            confidence: prediction.confidence,
            bbox: {
                x: prediction.x,
                y: prediction.y,
                width: prediction.width,
                height: prediction.height
            }
        }));

        // Make decision for each result pair
        const maxLength = Math.max(processedNlpResults.length, processedImgResults.length);
        
        for (let i = 0; i < maxLength; i++) {
            const nlpResult = processedNlpResults[i] || { adConfidence: 0, nonAdConfidence: 1 };
            const objectResult = processedImgResults[i] || { confidence: 0 };
            const nlpConfidence = nlpResult.adConfidence;
            const imgConfidence = objectResult.confidence;

            let decisionReason = 
                (nlpConfidence > 0.7 && imgConfidence > 0.7) ? 'Both models highly confident' :
                (nlpConfidence > 0.7 && imgConfidence < 0.5) ? 'NLP highly confident, Object Detection uncertain' :
                (imgConfidence > 0.7 && nlpConfidence < 0.5) ? 'Object Detection highly confident, NLP uncertain' :
                (nlpConfidence > 0.5 && imgConfidence > 0.5) ? 'Both models moderately confident' :
                'Insufficient confidence from both models';

            const isAd = decisionReason !== 'Insufficient confidence from both models';

            decisions.push({
                isAd,
                decisionReason,
                details: {
                    nlp: nlpResult,
                    objectDetection: {
                        ...objectResult,
                        originalPrediction: imgResults[i] || null
                    }
                }
            });

            console.log(`Decision ${i + 1}:`, {
                isAd,
                decisionReason,
                nlpConfidence,
                imgConfidence
            });
        }

        return decisions;

    } catch (error) {
        console.error("Decision model error:", error);
        return [{
            isAd: false,
            decisionReason: 'Error in decision process',
            error: error.message
        }];
    }
}

module.exports = { makeDecision };



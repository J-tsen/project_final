from flask import Flask, request, jsonify
from flask_cors import CORS
import torch
from transformers import BertTokenizer, BertForSequenceClassification
import os

app = Flask(__name__)
CORS(app)  # Enable CORS
# Load the model and tokenizer
model_path = os.path.join(os.path.dirname(__file__), "bertModel")
tokenizer = BertTokenizer.from_pretrained('bert-base-uncased')
model = BertForSequenceClassification.from_pretrained(model_path)
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
model.to(device)
model.eval()

@app.route('/analyze', methods=['POST'])
def analyze():
    try:
        data = request.json
        text = data.get('text', '')
        
        # Return default response for empty text
        if not text or text.strip() == '':
            return jsonify({
                "text": "",
                "prediction": "Non-Ad",
                "confidence": {
                    "Non-Ad": 1.0,
                    "Ad": 0.0
                }
            })    
        # Tokenize
        inputs = tokenizer(
            text,
            padding='max_length',
            truncation=True,
            max_length=128,
            return_tensors='pt'
        )
        
        # Move inputs to the same device as model
        inputs = {k: v.to(device) for k, v in inputs.items()}
        
        # Get prediction
        with torch.no_grad():
            outputs = model(**inputs)
            probabilities = torch.nn.functional.softmax(outputs.logits, dim=1)
            prediction = torch.argmax(probabilities, dim=1)
            confidence_scores = probabilities[0].tolist()
        
        return jsonify({
            "text": text,
            "prediction": "Ad" if prediction.item() == 1 else "Non-Ad",
            "confidence": {
                "Non-Ad": confidence_scores[0],
                "Ad": confidence_scores[1]
            }
        })
        
    except Exception as e:
        print(f"Error processing request: {str(e)}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
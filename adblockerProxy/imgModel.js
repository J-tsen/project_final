const ROBOFLOW_API_KEY = process.env.api_key;

async function processImage(image) {
  const response = await fetch(
    "https://detect.roboflow.com/infer/workflows/jt-project-zgage/imgmodelv2",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: ROBOFLOW_API_KEY,
        inputs: {
          image: { type: "base64", value: image },
        },
      }),
    }
  );

  const result = await response.json();
  return {
    result: result,
    texts: result.outputs?.[0]?.model_1 || []
  };
}

module.exports = { processImage };

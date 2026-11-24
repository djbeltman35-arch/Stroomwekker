// AWS Lambda (Node.js 22, regio eu-west-1): geeft elke Alexa-directive door aan Stroomwekker.
export const handler = async (event) => {
  const r = await fetch('https://stroomwekker.eu/api/alexa', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event),
  });
  return await r.json();
};

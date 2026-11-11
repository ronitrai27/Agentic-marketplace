globalThis.fetch = async (_url, options) => {
  const body = JSON.parse(options.body);
  if (!body.tools?.some(tool => tool.googleSearch || tool.google_search)) throw new Error("Google Search tool missing");
  return Response.json({
  candidates: [{
    content: { parts: [{ text: "Fixture answer." }] },
    groundingMetadata: {
      groundingChunks: [{ web: { uri: "https://example.com/evidence", title: "Evidence" } }],
      groundingSupports: [{ segment: { text: "Fixture answer." }, groundingChunkIndices: [0] }]
    }
  }]
});
};

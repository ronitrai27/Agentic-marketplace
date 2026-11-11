globalThis.fetch = async () => Response.json({
  candidates: [{
    content: { parts: [{ text: "Fixture answer." }] },
    groundingMetadata: {
      groundingChunks: [{ web: { uri: "https://example.com/evidence", title: "Evidence" } }],
      groundingSupports: [{ segment: { text: "Fixture answer." }, groundingChunkIndices: [0] }]
    }
  }]
});

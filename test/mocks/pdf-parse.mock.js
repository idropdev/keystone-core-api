/**
 * Mock for pdf-parse to prevent native binding (CustomGC) from being loaded in tests
 * This prevents open handles from @napi-rs/canvas that keep Jest from exiting
 * 
 * pdf-parse exports { PDFParse } as a named export, which is what the code expects
 */

// Mock PDFParse function that returns a Promise with PDF data
function PDFParse(buffer, options) {
  return Promise.resolve({
    numpages: 1,
    numrender: 1,
    info: {},
    metadata: null,
    text: '',
    version: '1.0.0',
  });
}

module.exports = {
  PDFParse,
};

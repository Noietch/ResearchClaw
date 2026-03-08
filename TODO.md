# TODO

## Semantic Search

- Add a built-in embedding provider so semantic indexing and semantic search can run without requiring Ollama.
- Keep Ollama as an optional advanced provider after introducing a provider abstraction.
- Evaluate runtime options for the built-in path, such as ONNX Runtime, Transformers.js, or another packaged local inference backend.
- Decide whether the built-in embedding model should ship with the app or be downloaded on first use.
- Reuse the existing background download / progress UX for any future built-in model assets.

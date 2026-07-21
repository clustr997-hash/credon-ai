# Credon Vision Alpha

Credon Vision Alpha is the product layer for image understanding in Credon AI. It is not just OCR and not just a third-party model wrapper: it combines image metadata, OCR, optional local multimodal analysis, and Credon-specific formatting so chat can reason about uploaded images naturally.

## What it does now

1. Reads image metadata such as size, aspect ratio, and format.
2. Runs OCR to capture readable text.
3. Detects an image content type hint such as `comic_page`, `study_document`, `screenshot_debug`, or `general_image`.
4. Calls an optional local Ollama vision model using `OLLAMA_VISION_MODEL`.
5. Wraps the result as `Credon Vision Alpha analysis` so the next chat answer receives visual context, not only indexed text.
6. Falls back to OCR + metadata synthesis when no vision model is available.

## Why this is Credon's own vision layer

The base visual encoder can be replaced later, but the Credon layer controls:

- routing between OCR, local vision, and fallback synthesis;
- content-type detection;
- comic/page/design-specific analysis prompts;
- what gets indexed into the user's knowledge store;
- the context format injected into chat;
- future evaluation, fine-tuning data, and product behavior.

## Roadmap to a truly owned model

1. **Vision Alpha router**: keep the current OCR + local model + fallback pipeline stable.
2. **Dataset capture**: store user-approved image analyses, corrections, OCR output, and expected answers.
3. **Evaluator set**: create tests for comics, screenshots, diagrams, documents, and UI images.
4. **Fine-tuned adapter**: train a small adapter/LoRA on approved Credon image tasks.
5. **Custom VLM serving**: host the tuned model behind the same `describe_image_bytes` contract.
6. **Multimodal memory**: save image summaries, visible entities, OCR text, and user corrections as searchable knowledge.

This approach lets Credon feel like its own product immediately while still allowing deeper model ownership over time.

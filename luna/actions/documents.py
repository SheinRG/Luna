"""Document text extraction and chunked summarization (SPEC §2/§8).

Uploads land in ``<data_dir>/uploads/<attachment_id>/<name>`` (see the upload
route). Text is extracted with pypdf for PDFs and a plain UTF-8 read for
text/markdown. Summarization is map-reduce over ~6k-char chunks so a large
document still fits the 4096-token context of llama3.2:3b.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pypdf import PdfReader

from luna.config import get_data_dir
from luna.core.ollama_client import OllamaError, chat_once

TEXT_EXTENSIONS = {".txt", ".md", ".markdown", ".log", ".csv", ".json", ".py", ".js"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic", ".svg"}

_CHUNK_CHARS = 8_000  # ~2k tokens/chunk — fits 4096 num_ctx with room for the reply
_MAX_CHUNKS = 8  # cap LLM cost for huge files


def classify_upload(name: str) -> str:
    ext = Path(name).suffix.lower()
    if ext == ".pdf":
        return "pdf"
    if ext in IMAGE_EXTENSIONS:
        return "image"
    return "text"


def extract_text(path: Path) -> str:
    """Extract plain text from a PDF or text file. Raises ValueError on failure."""
    ext = path.suffix.lower()
    if ext == ".pdf":
        try:
            reader = PdfReader(str(path))
            pages = [page.extract_text() or "" for page in reader.pages]
            return "\n\n".join(pages).strip()
        except Exception as exc:  # pypdf raises a zoo of exception types
            raise ValueError(f"Couldn't read PDF: {exc}") from exc
    try:
        return path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError as exc:
        raise ValueError(f"Couldn't read file: {exc}") from exc


def find_attachment(attachment_id: str) -> Path | None:
    """Locate an uploaded file by its attachment id."""
    folder = get_data_dir() / "uploads" / attachment_id
    if not folder.is_dir():
        return None
    files = [p for p in folder.iterdir() if p.is_file()]
    return files[0] if files else None


def _chunk(text: str) -> list[str]:
    chunks = [text[i : i + _CHUNK_CHARS] for i in range(0, len(text), _CHUNK_CHARS)]
    return chunks[:_MAX_CHUNKS]


async def summarize_document(attachment_id: str, *, model: str) -> dict[str, Any]:
    """Summarize an uploaded document with chunked map-reduce LLM calls."""
    path = find_attachment(attachment_id)
    if path is None:
        return {"status": "error", "detail": "Attachment not found — try re-uploading the file."}
    if classify_upload(path.name) == "image":
        return {
            "status": "error",
            "detail": f"{path.name} is an image — I run a text-only model, so I can't read it.",
        }
    try:
        text = extract_text(path)
    except ValueError as exc:
        return {"status": "error", "detail": str(exc)}
    if not text:
        return {"status": "error", "detail": f"{path.name} contains no extractable text."}

    chunks = _chunk(text)
    try:
        if len(chunks) == 1:
            summary = await chat_once(
                [
                    {"role": "system", "content": "Summarize the document concisely: key points as a short bulleted list, then a one-sentence takeaway."},
                    {"role": "user", "content": chunks[0]},
                ],
                model=model,
            )
        else:
            partials: list[str] = []
            for i, chunk in enumerate(chunks):
                partial = await chat_once(
                    [
                        {"role": "system", "content": f"Summarize part {i + 1}/{len(chunks)} of a document in 3-4 bullet points. Only the bullets."},
                        {"role": "user", "content": chunk},
                    ],
                    model=model,
                )
                partials.append(partial)
            summary = await chat_once(
                [
                    {"role": "system", "content": "Merge these partial summaries of one document into a single concise summary: key points as bullets, then a one-sentence takeaway."},
                    {"role": "user", "content": "\n\n".join(partials)},
                ],
                model=model,
            )
    except OllamaError as exc:
        return {"status": "error", "detail": f"Summarization failed: {exc}"}
    truncated = len(text) > _CHUNK_CHARS * _MAX_CHUNKS
    return {
        "status": "ok",
        "detail": summary.strip(),
        "data": {"file": path.name, "chars": len(text), "truncated": truncated},
    }

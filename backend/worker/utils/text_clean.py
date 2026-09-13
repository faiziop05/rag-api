import re


def strip_markdown_artifacts(text: str) -> str:
    """
    Medium/deep-mode documents are parsed via Docling, which EXPORTS the PDF
    as markdown — it adds bullet markers ("* "), heading hashes ("## "),
    emphasis asterisks ("**bold**"), and pipe-delimited table syntax
    ("| cell | cell |" plus a "|---|---|" separator row) that do not exist
    in the PDF's actual visible text or spoken language. Used in two
    places: citations.py strips this for the PDF viewer's exact-text-match
    highlighting (raw markdown syntax never appears in the PDF's own text,
    so left in, a table-derived excerpt could never match the page) and
    pipeline/processor.py strips it from the text that gets EMBEDDED for
    retrieval (a chunk of raw "| | | database... |---|---|---|" is noisy,
    hard-to-match input for an embedding model — the stored `content` used
    for LLM context is left untouched, since the LLM benefits from seeing
    real table structure when answering questions about one).
    """
    # Markdown table syntax: drop separator rows entirely (they carry no
    # content, just dashes/colons/pipes) and turn real rows into plain
    # space-separated cell text.
    text = re.sub(r"(?m)^[ \t]*\|?[ \t:|-]+\|?[ \t]*$", "", text)
    text = text.replace("|", " ")
    # Leading list markers / heading hashes at the start of each line.
    text = re.sub(r"(?m)^[ \t]*(?:[-*+]|#{1,6}|\d+[.)])[ \t]+", "", text)
    # Bold / italic emphasis markers (keep the wrapped text).
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"(?<!\w)\*([^*\n]+)\*(?!\w)", r"\1", text)
    text = re.sub(r"(?<!\w)_([^_\n]+)_(?!\w)", r"\1", text)
    # Inline code backticks.
    text = text.replace("`", "")
    return text

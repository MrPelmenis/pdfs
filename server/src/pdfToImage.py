import os
from pdf2image import convert_from_path

OUTPUT_DIR = "./pdf-preview-images"
MAX_W, MAX_H = 400, 600


def generate_preview(pdf_path: str, output_dir: str = OUTPUT_DIR) -> str:
    os.makedirs(output_dir, exist_ok=True)

    basename = os.path.basename(pdf_path)
    output_name = os.path.splitext(basename)[0] + ".jpeg"
    output_path = os.path.join(output_dir, output_name)

    pages = convert_from_path(pdf_path, dpi=180, first_page=1, last_page=1)
    img = pages[0]

    if img.width > MAX_W or img.height > MAX_H:
        img.thumbnail((MAX_W, MAX_H))

    img.save(output_path, "JPEG", quality=85)
    return output_path

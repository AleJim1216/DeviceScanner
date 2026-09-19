from api.config import CAPTURE_COACH
from api.datasets import image_index, label_rows
from api.features import load_bgr, measure


def main() -> None:
    labels = {row["image_id"]: row for row in label_rows()}
    index = image_index()
    keys = [
        "lap_var",
        "log_lap",
        "subject_mean",
        "hot_frac",
        "edge_max",
        "orange_frac",
        "orange_blobs",
        "orange_touch",
        "orange_flat",
        "orange_text",
        "ink_frac",
        "bbox_margin",
        "touch_sides",
        "subject_frac",
        "redacted_frac",
    ]
    print("id view status codes " + " ".join(keys))
    for image_id, label in labels.items():
        stats = measure(load_bgr(CAPTURE_COACH / index[image_id]["relative_path"]))
        codes = label.get("issue_codes") or "-"
        vals = " ".join(f"{stats[key]:.4f}" for key in keys)
        print(f"{image_id} {label['observed_view']} {label['status']} {codes} {vals}")


if __name__ == "__main__":
    main()

import { icon } from "./icons";

/**
 * Share panel: lets the player frame the model (the canvas stays interactive),
 * download a square snapshot of the current view, and copy the unique URL for
 * the creation. Lives as a floating card on the right so the model remains
 * visible and orbitable on the left.
 */
export interface ShareHost {
  /** Square PNG data URL of the current view. */
  captureThumb(): string;
  /** unique shareable URL for the creation id. */
  shareUrl(id: string): string;
  /** persist the snapshot thumbnail to the creation. */
  saveShare(id: string, thumb: string): Promise<void>;
  onClose(): void;
}

export class ShareView {
  readonly el: HTMLElement;
  private img: HTMLImageElement;
  private urlInput: HTMLInputElement;
  private copyBtn: HTMLButtonElement;
  private id = "";

  constructor(private host: ShareHost) {
    this.el = document.createElement("div");
    this.el.className = "share-view hidden";

    const card = document.createElement("div");
    card.className = "share-card";

    const head = document.createElement("div");
    head.className = "share-head";
    head.innerHTML = `<span>Share your creation</span>`;
    const close = document.createElement("button");
    close.className = "icon-btn";
    close.title = "Close";
    close.innerHTML = icon("close");
    close.addEventListener("click", () => this.host.onClose());
    head.appendChild(close);

    const hint = document.createElement("p");
    hint.className = "share-hint";
    hint.textContent = "Drag the model to frame your shot.";

    this.img = document.createElement("img");
    this.img.className = "share-thumb";
    this.img.alt = "snapshot";

    const urlRow = document.createElement("div");
    urlRow.className = "share-url-row";
    this.urlInput = document.createElement("input");
    this.urlInput.className = "share-input";
    this.urlInput.readOnly = true;
    this.copyBtn = document.createElement("button");
    this.copyBtn.className = "pill-btn";
    this.copyBtn.innerHTML = this.copyLabel();
    this.copyBtn.addEventListener("click", () => this.copy());
    urlRow.append(this.urlInput, this.copyBtn);

    const download = document.createElement("button");
    download.className = "pill-btn primary share-download";
    download.innerHTML = `<span class="pa-ic" style="width:16px;height:16px;display:inline-flex;vertical-align:-3px;margin-right:6px">${icon("save")}</span>Download image`;
    download.addEventListener("click", () => this.download());

    card.append(head, hint, this.img, urlRow, download);
    this.el.appendChild(card);
  }

  private copyLabel(): string {
    return `<span class="pa-ic" style="width:16px;height:16px;display:inline-flex;vertical-align:-3px;margin-right:6px">${icon(
      "copy"
    )}</span>Copy link`;
  }

  open(id: string): void {
    this.id = id;
    this.urlInput.value = this.host.shareUrl(id);
    this.img.src = this.host.captureThumb();
    this.copyBtn.innerHTML = this.copyLabel();
    this.el.classList.remove("hidden");
  }

  close(): void {
    this.el.classList.add("hidden");
  }

  /** Re-grab the snapshot for the current view (called after repositioning). */
  refreshThumb(): void {
    if (!this.el.classList.contains("hidden")) this.img.src = this.host.captureThumb();
  }

  private async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.urlInput.value);
      this.copyBtn.textContent = "Copied!";
    } catch {
      this.urlInput.select();
      this.copyBtn.textContent = "Press ⌘C";
    }
  }

  /** Download the displayed snapshot (and save it as the creation's thumbnail). */
  private download(): void {
    const url = this.img.src;
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = "voxel-creation.png";
    a.click();
    void this.host.saveShare(this.id, url);
  }
}

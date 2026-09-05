# useImagePaste.ts — index

Clipboard-image-paste state. Supports uncontrolled (owns `pendingImages`) and controlled (`images`/`onImagesChange`) modes. Exports `MAX_IMAGE_SIZE` (10MB base64), `SUPPORTED_IMAGE_TYPES` set. Returns `{ pendingImages, imageError, handlePaste, removeImage, clearImages, addFiles }`. `addFiles(FileList|File[])` shares paste's MIME/size validation (`ingestBlob`) for the composer `＋` attach-image file-picker path. Auto-clears errors after 3s. See change: redesign-prompt-input.

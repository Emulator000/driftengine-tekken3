#!/bin/sh
# The remaster's tools, into .cache/remaster/: stable-diffusion.cpp's Vulkan build, Z-Image-Turbo with
# its text encoder and VAE, and PBRify's models, each checked against its SHA-256; then a Python with
# PyTorch and spandrel: for the CPU, or with `--rocm` (an AMD GPU) or `--cuda` (an NVIDIA GPU) the
# GPU's PyTorch.
set -e
here=$(cd "$(dirname "$0")/../.." && pwd)
C="$here/.cache/remaster"
get() { # url, file, sha256
  mkdir -p "$(dirname "$2")"
  [ -f "$2" ] && echo "$3  $2" | sha256sum -c --status && return 0
  curl -sSL --retry 3 -o "$2" "$1"
  echo "$3  $2" | sha256sum -c --status || { echo "$2: SHA-256 does not match"; rm -f "$2"; exit 1; }
  echo "fetched $2"
}
get https://github.com/leejet/stable-diffusion.cpp/releases/download/master-964-1d0a58a/sd-master-1d0a58a-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip "$C/bin/sd/sd-vulkan.zip" bade142929edfa7aad56aba46376e55142d14390262b904f4a2deb3a03ceb21d
(cd "$C/bin/sd" && unzip -oq sd-vulkan.zip)
get https://huggingface.co/leejet/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q4_K.gguf "$C/weights/zimage/z_image_turbo-Q4_K.gguf" 14b375ab4f226bc5378f68f37e899ef3c2242b8541e61e2bc1aff40976086fbd
get https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf "$C/weights/qwen3/Qwen3-4B-Instruct-2507-Q4_K_M.gguf" 3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597
get https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors "$C/weights/vae/ae.safetensors" afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38
get https://github.com/Kim2091/Kim2091-Models/releases/download/4x-PBRify_UpscalerV4/4x-PBRify_UpscalerV4.pth "$C/weights/pbrify/4x-PBRify_UpscalerV4.pth" 82db39e31e01da6816a9814c0553a8dcdb7bd2d655353e67075c9295068cb789
get https://github.com/Kim2091/PBRify_Remix/raw/main/Models/1x-PBRify_NormalV3.pth "$C/weights/pbrify/1x-PBRify_NormalV3.pth" b0a18270da765f02eaae3c228203bee0677fc28b2854a562515e4aae9c61223b
get https://github.com/Kim2091/PBRify_Remix/raw/main/Models/1x-PBRify_Height.pth "$C/weights/pbrify/1x-PBRify_Height.pth" 5b973ecb8bae9d96d14d77b8a8f1d88fb6a8580bcc1bb55d2872811acdc4277d
get https://github.com/Kim2091/PBRify_Remix/raw/main/Models/1x-PBRify_RoughnessV2.pth "$C/weights/pbrify/1x-PBRify_RoughnessV2.pth" 7003c39041af64cdb77d5120bd560a2878538fbb14a07657d8fd12aac5773679
py() { # folder, PyTorch's index, PyTorch's version
  [ -d "$C/$1" ] || uv venv -q --python 3.12 "$C/$1"
  VIRTUAL_ENV="$C/$1" uv pip install -q --index-url "https://download.pytorch.org/whl/$2" --extra-index-url https://pypi.org/simple --index-strategy unsafe-best-match "torch==$3" torchvision spandrel pillow numpy
}
case "$1" in
  --rocm) py py-rocm rocm7.2 2.14.1+rocm7.2 ;;
  --cuda) py py-cuda cu130 2.14.1+cu130 ;;
  *) py py cpu 2.14.1+cpu ;;
esac

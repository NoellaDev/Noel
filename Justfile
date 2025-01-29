# Justfile

# Default release command
release:
    @echo "Building release version..."
    cargo build --release
    @just copy-binary

# Build Windows executable
release-windows:
    #!/usr/bin/env sh
    if [ "$(uname)" = "Darwin" ] || [ "$(uname)" = "Linux" ]; then
        echo "Building Windows executable using Docker..."
        docker run --rm -v "$(pwd)":/usr/src/myapp -w /usr/src/myapp \
            rust:latest \
            sh -c "rustup target add x86_64-pc-windows-gnu && \
                apt-get update && \
                apt-get install -y mingw-w64 && \
                cargo build --release --target x86_64-pc-windows-gnu"
    else
        echo "Building Windows executable natively..."
        powershell.exe -Command "docker run --rm -v ${PWD}:/usr/src/myapp -w /usr/src/myapp rust:latest sh -c 'rustup target add x86_64-pc-windows-gnu && apt-get update && apt-get install -y mingw-w64 && cargo build --release --target x86_64-pc-windows-gnu'"
    fi
    @echo "Windows executable created at ./target/x86_64-pc-windows-gnu/release/goosed.exe"

# Copy binary command
copy-binary:
    @if [ -f ./target/release/goosed ]; then \
        echo "Copying goosed binary to ui/desktop/src/bin with permissions preserved..."; \
        cp -p ./target/release/goosed ./ui/desktop/src/bin/; \
    else \
        echo "Release binary not found."; \
        exit 1; \
    fi

# Run UI with latest
run-ui:
    @just release
    @echo "Running UI..."
    cd ui/desktop && npm install && npm run start-gui

# Run Docusaurus server for documentation
run-docs:
    @echo "Running docs server..."
    cd documentation && yarn && yarn start

# Run server
run-server:
    @echo "Running server..."
    cargo run -p goose-server

# make GUI with latest binary
make-ui:
    @just release
    cd ui/desktop && npm run bundle:default

# make GUI with latest Windows binary
make-ui-windows:
    @just release-windows
    @if [ -f ./target/x86_64-pc-windows-gnu/release/goosed.exe ]; then \
        echo "Copying Windows binary to ui/desktop/src/bin..."; \
        cp -p ./target/x86_64-pc-windows-gnu/release/goosed.exe ./ui/desktop/src/bin/; \
    else \
        echo "Windows binary not found."; \
        exit 1; \
    fi
    cd ui/desktop && npm run bundle:windows

# Setup langfuse server
langfuse-server:
    #!/usr/bin/env bash
    ./scripts/setup_langfuse.sh
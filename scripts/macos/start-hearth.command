#!/bin/bash
# Double-click in Finder to run Hearth in a Terminal window. Close the window
# or press Ctrl+C to stop. (If macOS says it can't be opened, right-click > Open.)
exec "$(dirname "$0")/../start.sh"

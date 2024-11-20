 #!/usr/bin/env bash

 # Execute this file to install the phicoin cli tools into your path on OS X

 CURRENT_LOC="$( cd "$(dirname "$0")" ; pwd -P )"
 LOCATION=${CURRENT_LOC%PHICOIN-Qt.app*}

 # Ensure that the directory to symlink to exists
 sudo mkdir -p /usr/local/bin

 # Create symlinks to the cli tools
 sudo ln -s ${LOCATION}/PHICOIN-Qt.app/Contents/MacOS/phicoind /usr/local/bin/phicoind
 sudo ln -s ${LOCATION}/PHICOIN-Qt.app/Contents/MacOS/phicoin-cli /usr/local/bin/phicoin-cli

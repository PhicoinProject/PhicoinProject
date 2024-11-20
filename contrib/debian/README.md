
Debian
====================
This directory contains files used to package phicoind/phicoin-qt
for Debian-based Linux systems. If you compile phicoind/phicoin-qt yourself, there are some useful files here.

## phicoin: URI support ##


phicoin-qt.desktop  (Gnome / Open Desktop)
To install:

	sudo desktop-file-install phicoin-qt.desktop
	sudo update-desktop-database

If you build yourself, you will either need to modify the paths in
the .desktop file or copy or symlink your phicoin-qt binary to `/usr/bin`
and the `../../share/pixmaps/phicoin128.png` to `/usr/share/pixmaps`

phicoin-qt.protocol (KDE)


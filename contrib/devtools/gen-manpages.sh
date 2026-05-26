#!/bin/sh

TOPDIR=${TOPDIR:-$(git rev-parse --show-toplevel)}
SRCDIR=${SRCDIR:-$TOPDIR/src}
MANDIR=${MANDIR:-$TOPDIR/doc/man}

PHICOIND=${PHICOIND:-$SRCDIR/phicoind}
PHICOINCLI=${PHICOINCLI:-$SRCDIR/phicoin-cli}
PHICOINTX=${PHICOINTX:-$SRCDIR/phicoin-tx}
PHICOINQT=${PHICOINQT:-$SRCDIR/qt/phicoin-qt}

[ ! -x $PHICOIND ] && echo "$PHICOIND not found or not executable." && exit 1

# The autodetected version git tag can screw up manpage output a little bit
PHIVER=($($PHICOINCLI --version | head -n1 | awk -F'[ -]' '{ print $6, $7 }'))

# Create a footer file with copyright content.
# This gets autodetected fine for phicoind if --version-string is not set,
# but has different outcomes for phicoin-qt and phicoin-cli.
echo "[COPYRIGHT]" > footer.h2m
$PHICOIND --version | sed -n '1!p' >> footer.h2m

for cmd in $PHICOIND $PHICOINCLI $PHICOINTX $PHICOINQT; do
  cmdname="${cmd##*/}"
  help2man -N --version-string=${PHIVER[0]} --include=footer.h2m -o ${MANDIR}/${cmdname}.1 ${cmd}
  sed -i "s/\\\-${PHIVER[1]}//g" ${MANDIR}/${cmdname}.1
done

rm -f footer.h2m

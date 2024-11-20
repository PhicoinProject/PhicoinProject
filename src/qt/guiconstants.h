// Copyright (c) 2011-2016 The Bitcoin Core developers
// Copyright (c) 2017-2021  The Ravncore developers
// Copyright (c) @2024 		The PHICOIN Core developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#ifndef PHICOIN_QT_GUICONSTANTS_H
#define PHICOIN_QT_GUICONSTANTS_H

/* Milliseconds between model updates */
static const int MODEL_UPDATE_DELAY = 250;

/* AskPassphraseDialog -- Maximum passphrase length */
static const int MAX_PASSPHRASE_SIZE = 1024;

/* PHICOINGUI -- Size of icons in status bar */
static const int STATUSBAR_ICONSIZE = 16;

static const bool DEFAULT_SPLASHSCREEN = true;

/* Invalid field background style */
#define STYLE_INVALID "background:#FF8080; border: 1px solid lightgray; padding: 0px;"
#define STYLE_VALID "border: 1px solid lightgray; padding: 0px;"

/* Transaction list -- unconfirmed transaction */
#define COLOR_UNCONFIRMED QColor(128, 128, 128)
/* Transaction list -- negative amount */
#define COLOR_NEGATIVE QColor(255, 0, 0)
/* Transaction list -- bare address (without label) */
#define COLOR_BAREADDRESS QColor(140, 140, 140)
/* Transaction list -- TX status decoration - open until date */
#define COLOR_TX_STATUS_OPENUNTILDATE QColor(64, 64, 255)
/* Transaction list -- TX status decoration - danger, tx needs attention */
#define COLOR_TX_STATUS_DANGER QColor(200, 100, 100)
/* Transaction list -- TX status decoration - default color */
#define COLOR_BLACK QColor(0, 0, 0)
/* Widget Background color - default color */
#define COLOR_WHITE QColor(255, 255, 255)

#define COLOR_WALLETFRAME_SHADOW QColor(0,0,0,71)

/* Color of labels */
#define COLOR_LABELS QColor("#4960ad")

/** LIGHT MODE */
/* Background color, very light gray */
#define COLOR_BACKGROUND_LIGHT QColor("#fbfbfe")
/* PHICOIN dark orange */
#define COLOR_DARK_ORANGE QColor("#f05239")
/* PHICOIN light orange */
#define COLOR_LIGHT_ORANGE QColor("#f79433")
/* PHICOIN dark blue */
#define COLOR_DARK_BLUE QColor("#384192")
/* PHICOIN light blue */
#define COLOR_LIGHT_BLUE QColor("#5874cf")
/* PHICOIN asset text */
#define COLOR_ASSET_TEXT QColor(255, 255, 255)
/* PHICOIN shadow color - light mode */
#define COLOR_SHADOW_LIGHT QColor("#e1e6f3")
/* Toolbar not selected text color */
#define COLOR_TOOLBAR_NOT_SELECTED_TEXT QColor("#a5b7f3")
/* Toolbar selected text color */
#define COLOR_TOOLBAR_SELECTED_TEXT COLOR_WHITE
/* Send entries background color */
#define COLOR_SENDENTRIES_BACKGROUND QColor("#fbfbfe")


/** DARK MODE */
/* Widget background color, dark mode */
#define COLOR_WIDGET_BACKGROUND_DARK QColor("#1e1e1e")
/* Shadow color - dark mode */
#define COLOR_SHADOW_DARK QColor("#2a2a2a")
/* Light blue - dark mode */
#define COLOR_LIGHT_BLUE_DARK QColor("#2d2d2d")
/* Dark blue - dark mode */
#define COLOR_DARK_BLUE_DARK QColor("#1e1e1e")
/* Pricing widget background color */
#define COLOR_PRICING_WIDGET QColor("#2d2d2d")
/* Administrator background color - dark mode */
#define COLOR_ADMIN_CARD_DARK QColor("#1e1e1e")
/* Regular asset background color - dark mode */
#define COLOR_REGULAR_CARD_DARK_BLUE_DARK_MODE QColor("#1e1e1e")
/* Light blue background color - dark mode */
#define COLOR_REGULAR_CARD_LIGHT_BLUE_DARK_MODE QColor("#2d2d2d")
/* Toolbar not selected text color */
#define COLOR_TOOLBAR_NOT_SELECTED_TEXT_DARK_MODE QColor("#808080")
/* Toolbar selected text color */
#define COLOR_TOOLBAR_SELECTED_TEXT_DARK_MODE QColor("#d4d4d4")
/* Send entries background color dark mode */
#define COLOR_SENDENTRIES_BACKGROUND_DARK QColor("#1e1e1e")

/* Label colors */
#define STRING_LABEL_COLOR "color: #d4d4d4"  // Light gray for regular labels
#define STRING_LABEL_COLOR_WARNING "color: #f14c4c"  // Red for warnings









/* Tooltips longer than this (in characters) are converted into rich text,
   so that they can be word-wrapped.
 */
static const int TOOLTIP_WRAP_THRESHOLD = 80;

/* Maximum allowed URI length */
static const int MAX_URI_LENGTH = 255;

/* QRCodeDialog -- size of exported QR Code image */
#define QR_IMAGE_SIZE 300

/* Number of frames in spinner animation */
#define SPINNER_FRAMES 36

#define QAPP_ORG_NAME "PHICOIN"
#define QAPP_ORG_DOMAIN "phicoin.net"
#define QAPP_APP_NAME_DEFAULT "PHICOIN-Qt"
#define QAPP_APP_NAME_TESTNET "PHICOIN-Qt-testnet"

/* Default third party browser urls */
#define DEFAULT_THIRD_PARTY_BROWSERS "https://explorer.phicoin.net/tx/%s"

/* Default IPFS viewer */
#define DEFAULT_IPFS_VIEWER "https://ipfs.io/ipfs/%s"

#endif // PHICOIN_QT_GUICONSTANTS_H

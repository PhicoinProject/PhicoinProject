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
#define COLOR_LABELS QColor("#2B4A83")

/**  INSPIRED THEME - LIGHT MODE */
/* Background color -  style gradient light */
#define COLOR_BACKGROUND_LIGHT QColor("#F8FAFC")
/*  Primary Blue */
#define COLOR_SCALE_PRIMARY QColor("#2B4A83")
/*  Accent Blue */
#define COLOR_SCALE_ACCENT QColor("#3B82F6")
/*  Orange Accent */
#define COLOR_SCALE_ORANGE QColor("#F59E0B")
/*  Deep Blue */
#define COLOR_SCALE_DEEP QColor("#1E3A8A")
/*  Light Blue */
#define COLOR_SCALE_LIGHT QColor("#60A5FA")
/*  Card Background */
#define COLOR_CARD_BACKGROUND QColor("#FFFFFF")
/*  Border Color */
#define COLOR_BORDER_LIGHT QColor("#E5E7EB")
/*  Text Primary */
#define COLOR_TEXT_PRIMARY QColor("#111827")
/*  Text Secondary */
#define COLOR_TEXT_SECONDARY QColor("#6B7280")

/* PHICOIN dark orange - Updated to Scale style */
#define COLOR_DARK_ORANGE COLOR_SCALE_ORANGE
/* PHICOIN light orange - Updated to Scale style */  
#define COLOR_LIGHT_ORANGE QColor("#FCD34D")
/* PHICOIN dark blue - Updated to Scale style */
#define COLOR_DARK_BLUE COLOR_SCALE_PRIMARY
/* PHICOIN light blue - Updated to Scale style */
#define COLOR_LIGHT_BLUE COLOR_SCALE_ACCENT
/* PHICOIN asset text */
#define COLOR_ASSET_TEXT QColor(255, 255, 255)
/* PHICOIN shadow color - light mode - Updated to Scale style */
#define COLOR_SHADOW_LIGHT QColor("#0000000A")
/* Toolbar not selected text color - Scale style */
#define COLOR_TOOLBAR_NOT_SELECTED_TEXT COLOR_TEXT_SECONDARY
/* Toolbar selected text color - Scale style */
#define COLOR_TOOLBAR_SELECTED_TEXT COLOR_SCALE_PRIMARY
/* Send entries background color - Scale style */
#define COLOR_SENDENTRIES_BACKGROUND COLOR_CARD_BACKGROUND


/**  INSPIRED THEME - DARK MODE */
/* Background color -  style dark */
#define COLOR_BACKGROUND_DARK QColor("#0F172A")
/* Widget background color, dark mode - Scale style */
#define COLOR_WIDGET_BACKGROUND_DARK QColor("#1E293B")
/* Card background dark mode - Scale style */
#define COLOR_CARD_BACKGROUND_DARK QColor("#334155")
/* Shadow color - dark mode - Scale style */
#define COLOR_SHADOW_DARK QColor("#00000040")
/* Light blue - dark mode - Scale style */
#define COLOR_LIGHT_BLUE_DARK QColor("#60A5FA")
/* Dark blue - dark mode - Scale style */
#define COLOR_DARK_BLUE_DARK QColor("#1E40AF")
/* Pricing widget background color - Scale style */
#define COLOR_PRICING_WIDGET QColor("#1E293B")
/* Administrator background color - dark mode - Scale style */
#define COLOR_ADMIN_CARD_DARK QColor("#0F172A")
/* Regular asset background color - dark mode - Scale style */
#define COLOR_REGULAR_CARD_DARK_BLUE_DARK_MODE QColor("#334155")
/* Light blue background color - dark mode - Scale style */
#define COLOR_REGULAR_CARD_LIGHT_BLUE_DARK_MODE QColor("#475569")
/* Toolbar not selected text color - Scale dark style */
#define COLOR_TOOLBAR_NOT_SELECTED_TEXT_DARK_MODE QColor("#94A3B8")
/* Toolbar selected text color - Scale dark style */
#define COLOR_TOOLBAR_SELECTED_TEXT_DARK_MODE QColor("#F1F5F9")
/* Send entries background color dark mode - Scale style */
#define COLOR_SENDENTRIES_BACKGROUND_DARK QColor("#1E293B")
/* Border color dark mode - Scale style */
#define COLOR_BORDER_DARK QColor("#475569")
/* Text primary dark mode - Scale style */
#define COLOR_TEXT_PRIMARY_DARK QColor("#F1F5F9")
/* Text secondary dark mode - Scale style */
#define COLOR_TEXT_SECONDARY_DARK QColor("#94A3B8")

/* Label colors -  inspired */
#define STRING_LABEL_COLOR "color: #F1F5F9"  // Scale dark text
#define STRING_LABEL_COLOR_WARNING "color: #EF4444"  // Scale red for warnings
#define STRING_LABEL_COLOR_SUCCESS "color: #10B981"  // Scale green for success
#define STRING_LABEL_COLOR_INFO "color: #3B82F6"     // Scale blue for info

/*  Button Styles */
#define SCALE_BUTTON_PRIMARY "background: qlineargradient(x1:0, y1:0, x2:0, y2:1, stop:0 #3B82F6, stop:1 #2563EB); border: none; border-radius: 8px; color: white; padding: 12px 24px; font-weight: 600; font-size: 14px;"
#define SCALE_BUTTON_SECONDARY "background: #F3F4F6; border: 1px solid #E5E7EB; border-radius: 8px; color: #374151; padding: 12px 24px; font-weight: 500; font-size: 14px;"
#define SCALE_BUTTON_HOVER "background: qlineargradient(x1:0, y1:0, x2:0, y2:1, stop:0 #2563EB, stop:1 #1D4ED8);"

/*  Card Style */
#define SCALE_CARD_STYLE "background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 12px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); padding: 24px;"
#define SCALE_CARD_STYLE_DARK "background: #1E293B; border: 1px solid #475569; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3); padding: 24px;"

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

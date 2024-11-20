// Copyright (c) 2011-2016 The Bitcoin Core developers
// Copyright (c) 2017-2021 The Ravncore developers
// Copyright (c) @2024 The PHICOIN Core developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#if defined(HAVE_CONFIG_H)
#include "config/phicoin-config.h"
#endif

#include "splashscreen.h"
#include "networkstyle.h"
#include "clientversion.h"
#include "init.h"
#include "util.h"
#include "ui_interface.h"
#include "version.h"

#ifdef ENABLE_WALLET
#include "wallet/wallet.h"
#endif

#include <QApplication>
#include <QCloseEvent>
#include <QPainter>
#include <QRadialGradient>
#include <QScreen>

#if QT_VERSION < QT_VERSION_CHECK(5, 11, 0)
#define QTversionPreFiveEleven
#endif

#include <boost/bind/bind.hpp>
using namespace boost::placeholders;

SplashScreen::SplashScreen(const NetworkStyle* networkStyle)
    : QWidget(), curAlignment(0)
{
    int titleVersionVSpace = 25; // Increased spacing between lines
    int titleCopyrightVSpace = 40;

    float fontFactor = 1.0;
    float devicePixelRatio = 1.0;
#if QT_VERSION > 0x050100
    devicePixelRatio = ((QGuiApplication*)QCoreApplication::instance())->devicePixelRatio();
#endif

    // Define text to display
    QString titleText = tr(PACKAGE_NAME);
    QString versionText = QString("Version %1").arg(QString::fromStdString(FormatFullVersion()));
    QString copyrightText = QString::fromUtf8(CopyrightHolders(strprintf("\xc2\xA9 %u-%u ", 2009, COPYRIGHT_YEAR)).c_str());
    QString titleAddText = networkStyle->getTitleAddText();

    QString font = QApplication::font().toString();

    // Increase the window height to fit text and reduce the logo size
    QSize splashSize(480 * devicePixelRatio, 400 * devicePixelRatio);  // Increased height
    pixmap = QPixmap(splashSize);

    // Define dark-style gradient background
    QRadialGradient gradient(QPoint(splashSize.width() / 2, splashSize.height() / 2), splashSize.width() / 2);
    gradient.setColorAt(0, QColor(40, 40, 40));   // Dark gray at center
    gradient.setColorAt(1, QColor(70, 70, 70));   // Lighter gray at edges
    QPainter pixPaint(&pixmap);
    pixPaint.fillRect(pixmap.rect(), gradient);

    // Draw a smaller logo in the center
    QRect rectIcon(QPoint((splashSize.width() - 200) / 2, (splashSize.height() - 200) / 4), QSize(200, 200));  // Reduced size and adjusted position
    const QSize requiredSize(1024, 1024);
    QPixmap icon(networkStyle->getSplashIcon().pixmap(requiredSize));
    pixPaint.drawPixmap(rectIcon, icon);

    // Center title text under the logo
    pixPaint.setFont(QFont(font, 33 * fontFactor));
    QFontMetrics fm = pixPaint.fontMetrics();
    int titleTextWidth = fm.horizontalAdvance(titleText);
    pixPaint.setPen(Qt::white); // Set text color to white for contrast
    pixPaint.drawText((splashSize.width() - titleTextWidth) / 2, rectIcon.bottom() + titleVersionVSpace, titleText);

    // Center version text under title text
    pixPaint.setFont(QFont(font, 12 * fontFactor)); // Reduced font size for version number
    fm = pixPaint.fontMetrics();
    int versionTextWidth = fm.horizontalAdvance(versionText);
    pixPaint.drawText((splashSize.width() - versionTextWidth) / 2, rectIcon.bottom() + titleVersionVSpace * 2, versionText);

    // Draw copyright text centered below
    pixPaint.setFont(QFont(font, 10 * fontFactor));
    fm = pixPaint.fontMetrics(); // Update font metrics for current font
    int copyrightTextWidth = fm.horizontalAdvance(copyrightText);
    pixPaint.drawText((splashSize.width() - copyrightTextWidth) / 2, rectIcon.bottom() + titleVersionVSpace * 3, copyrightText);

    pixPaint.end();

    // Set window title
    setWindowTitle(titleText + " " + titleAddText);

    // Resize window, center on screen, disallow resizing
    QRect r(QPoint(), QSize(pixmap.size().width() / devicePixelRatio, pixmap.size().height() / devicePixelRatio));
    resize(r.size());
    setFixedSize(r.size());
    move(QGuiApplication::primaryScreen()->geometry().center() - r.center());

    subscribeToCoreSignals();
    installEventFilter(this);
}

SplashScreen::~SplashScreen()
{
    unsubscribeFromCoreSignals();
}

bool SplashScreen::eventFilter(QObject * obj, QEvent * ev) {
    if (ev->type() == QEvent::KeyPress) {
        QKeyEvent *keyEvent = static_cast<QKeyEvent *>(ev);
        if (keyEvent->text()[0] == 'q') {
            StartShutdown();
        }
    }
    return QObject::eventFilter(obj, ev);
}

void SplashScreen::slotFinish(QWidget *mainWin)
{
    Q_UNUSED(mainWin);

    if (isMinimized())
        showNormal();
    hide();
    deleteLater();
}

static void InitMessage(SplashScreen *splash, const std::string &message)
{
    QMetaObject::invokeMethod(splash, "showMessage",
        Qt::QueuedConnection,
        Q_ARG(QString, QString::fromStdString(message)),
        Q_ARG(int, Qt::AlignBottom | Qt::AlignHCenter),
        Q_ARG(QColor, QColor(255, 255, 255)));
}

static void ShowProgress(SplashScreen *splash, const std::string &title, int nProgress, bool resume_possible)
{
    InitMessage(splash, title + std::string("\n") +
            (resume_possible ? _( "(press q to shutdown and continue later)" )
                             : _( "press q to shutdown" )) +
            strprintf("\n%d", nProgress) + "%");
}

#ifdef ENABLE_WALLET
void SplashScreen::ConnectWallet(CWallet* wallet)
{
    wallet->ShowProgress.connect(boost::bind(ShowProgress, this, _1, _2, false));
    connectedWallets.push_back(wallet);
}
#endif

void SplashScreen::subscribeToCoreSignals()
{
    uiInterface.InitMessage.connect(boost::bind(InitMessage, this, _1));
    uiInterface.ShowProgress.connect(boost::bind(ShowProgress, this, _1, _2, _3));
#ifdef ENABLE_WALLET
    uiInterface.LoadWallet.connect(boost::bind(&SplashScreen::ConnectWallet, this, _1));
#endif
}

void SplashScreen::unsubscribeFromCoreSignals()
{
    uiInterface.InitMessage.disconnect(boost::bind(InitMessage, this, _1));
    uiInterface.ShowProgress.disconnect(boost::bind(ShowProgress, this, _1, _2, _3));
#ifdef ENABLE_WALLET
    for (CWallet* const & pwallet : connectedWallets) {
        pwallet->ShowProgress.disconnect(boost::bind(ShowProgress, this, _1, _2, false));
    }
#endif
}

void SplashScreen::showMessage(const QString &message, int alignment, const QColor &color)
{
    curMessage = message;
    curAlignment = alignment;
    curColor = color;
    update();
}

void SplashScreen::paintEvent(QPaintEvent *event)
{
    QPainter painter(this);
    painter.drawPixmap(0, 0, pixmap);
    QRect r = rect().adjusted(5, 5, -5, -5);
    painter.setPen(curColor);
    painter.drawText(r, curAlignment, curMessage);
}

void SplashScreen::closeEvent(QCloseEvent *event)
{
    StartShutdown();
    event->ignore();
} 

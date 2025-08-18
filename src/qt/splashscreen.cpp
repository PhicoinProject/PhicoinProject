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
#include "guiconstants.h"
#include "platformstyle.h"

#ifdef ENABLE_WALLET
#include "wallet/wallet.h"
#endif

#include <QApplication>
#include <QCloseEvent>
#include <QPainter>
#include <QLinearGradient>
#include <QRadialGradient>
#include <QScreen>
#include <QProgressBar>
#include <QVBoxLayout>
#include <QLabel>
#include <QFontDatabase>
#include <QRegExp>

#if QT_VERSION < QT_VERSION_CHECK(5, 11, 0)
#define QTversionPreFiveEleven
#endif

#include <boost/bind/bind.hpp>
using namespace boost::placeholders;

SplashScreen::SplashScreen(const NetworkStyle* networkStyle)
    : QWidget(), curAlignment(0)
{
    //  inspired spacing and sizing
    int titleVersionVSpace = 35;
    int titleCopyrightVSpace = 50;
    int logoTopMargin = 60;

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

    //  inspired modern window size
    QSize splashSize(600 * devicePixelRatio, 480 * devicePixelRatio);
    pixmap = QPixmap(splashSize);

    //  inspired dark gradient background
    QLinearGradient gradient(0, 0, 0, splashSize.height());
    gradient.setColorAt(0, QColor(0, 0, 0));                 // Pure black at top
    gradient.setColorAt(0.3, QColor(15, 23, 42));           // #0F172A - Very dark blue
    gradient.setColorAt(1, QColor(30, 41, 59));             // #1E293B - Slightly lighter at bottom
    
    QPainter pixPaint(&pixmap);
    pixPaint.setRenderHint(QPainter::Antialiasing);
    pixPaint.fillRect(pixmap.rect(), gradient);

    // Add  style colorful gradient decorations
    // Large gradient circle on the left
    QRadialGradient leftCircle(splashSize.width() * 0.2, splashSize.height() * 0.3, splashSize.width() * 0.4);
    leftCircle.setColorAt(0, QColor(147, 51, 234, 80));     // Purple with transparency
    leftCircle.setColorAt(0.5, QColor(59, 130, 246, 60));  // Blue with transparency
    leftCircle.setColorAt(1, QColor(0, 0, 0, 0));          // Transparent
    pixPaint.fillRect(pixmap.rect(), leftCircle);

    // Smaller gradient circle on the right
    QRadialGradient rightCircle(splashSize.width() * 0.8, splashSize.height() * 0.7, splashSize.width() * 0.3);
    rightCircle.setColorAt(0, QColor(34, 197, 94, 70));     // Green with transparency
    rightCircle.setColorAt(0.5, QColor(59, 130, 246, 50)); // Blue with transparency
    rightCircle.setColorAt(1, QColor(0, 0, 0, 0));         // Transparent
    pixPaint.fillRect(pixmap.rect(), rightCircle);

    // Draw logo with  style positioning
    QRect rectIcon(QPoint((splashSize.width() - 180) / 2, logoTopMargin), QSize(180, 180));
    const QSize requiredSize(1024, 1024);
    QPixmap icon(networkStyle->getSplashIcon().pixmap(requiredSize));
    
    // Add subtle shadow to logo
    pixPaint.setPen(QPen(QColor(0, 0, 0, 20), 2));
    pixPaint.setBrush(QBrush(QColor(0, 0, 0, 10)));
    pixPaint.drawEllipse(rectIcon.adjusted(2, 2, 2, 2));
    
    pixPaint.drawPixmap(rectIcon, icon);

    //  style title text - modern font
    QFontDatabase fontDb;
    QFont titleFont("Inter", 36 * fontFactor, QFont::Bold);
    if (!fontDb.families().contains("Inter")) {
        titleFont = QFont("SF Pro Display", 36 * fontFactor, QFont::Bold);
        if (!fontDb.families().contains("SF Pro Display")) {
            titleFont = QFont("Segoe UI", 36 * fontFactor, QFont::Bold);
        }
    }
    
    pixPaint.setFont(titleFont);
    QFontMetrics fm = pixPaint.fontMetrics();
    int titleTextWidth = fm.horizontalAdvance(titleText);
    
    //  white text for dark background
    pixPaint.setPen(QColor(255, 255, 255));  // Pure white for title
    pixPaint.drawText((splashSize.width() - titleTextWidth) / 2, 
                     rectIcon.bottom() + titleVersionVSpace, titleText);

    //  style version text
    QFont versionFont("Inter", 16 * fontFactor, QFont::Medium);
    if (!fontDb.families().contains("Inter")) {
        versionFont = QFont("SF Pro Display", 16 * fontFactor, QFont::Medium);
        if (!fontDb.families().contains("SF Pro Display")) {
            versionFont = QFont("Segoe UI", 16 * fontFactor, QFont::Medium);
        }
    }
    
    pixPaint.setFont(versionFont);
    fm = pixPaint.fontMetrics();
    int versionTextWidth = fm.horizontalAdvance(versionText);
    
    //  light blue accent for version
    pixPaint.setPen(QColor(96, 165, 250));  // Light blue #60A5FA
    pixPaint.drawText((splashSize.width() - versionTextWidth) / 2, 
                     rectIcon.bottom() + titleVersionVSpace + 45, versionText);

    //  style copyright text
    QFont copyrightFont("Inter", 12 * fontFactor, QFont::Normal);
    if (!fontDb.families().contains("Inter")) {
        copyrightFont = QFont("SF Pro Display", 12 * fontFactor, QFont::Normal);
        if (!fontDb.families().contains("SF Pro Display")) {
            copyrightFont = QFont("Segoe UI", 12 * fontFactor, QFont::Normal);
        }
    }
    
    pixPaint.setFont(copyrightFont);
    fm = pixPaint.fontMetrics();
    int copyrightTextWidth = fm.horizontalAdvance(copyrightText);
    
    //  light gray text for copyright
    pixPaint.setPen(QColor(148, 163, 184));  // Light gray #94A3B8
    pixPaint.drawText((splashSize.width() - copyrightTextWidth) / 2, 
                     splashSize.height() - 60, copyrightText);

    // Add  style loading area at bottom
    QRect loadingArea(50, splashSize.height() - 40, splashSize.width() - 100, 20);
    pixPaint.setPen(QPen(QColor(71, 85, 105), 1));  // Dark border #475569
    pixPaint.setBrush(QBrush(QColor(30, 41, 59)));   // Dark background #1E293B
    pixPaint.drawRoundedRect(loadingArea, 10, 10);

    pixPaint.end();

    // Set window properties with  style
    setWindowTitle(titleText + " " + titleAddText);
    setWindowFlags(Qt::Window | Qt::WindowTitleHint | Qt::WindowMinimizeButtonHint | Qt::WindowCloseButtonHint);
    
    // Modern window sizing
    QRect r(QPoint(), QSize(pixmap.size().width() / devicePixelRatio, 
                           pixmap.size().height() / devicePixelRatio));
    resize(r.size());
    setFixedSize(r.size());
    move(QGuiApplication::primaryScreen()->geometry().center() - r.center());

    //  style window properties
    setAttribute(Qt::WA_TranslucentBackground, false);
    setStyleSheet("QWidget { border-radius: 16px; }");

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
        Q_ARG(QColor, COLOR_TEXT_PRIMARY));
}

static void ShowProgress(SplashScreen *splash, const std::string &title, int nProgress, bool resume_possible)
{
    QString progressMessage = QString::fromStdString(title);
    if (nProgress >= 0) {
        progressMessage += QString("\n%1%").arg(nProgress);
    }
    
    if (resume_possible) {
        progressMessage += QString("\n") + QString::fromStdString(_("(press q to shutdown and continue later)"));
    } else {
        progressMessage += QString("\n") + QString::fromStdString(_("press q to shutdown"));
    }
    
    QMetaObject::invokeMethod(splash, "showMessage",
        Qt::QueuedConnection,
        Q_ARG(QString, progressMessage),
        Q_ARG(int, Qt::AlignBottom | Qt::AlignHCenter),
        Q_ARG(QColor, COLOR_TEXT_PRIMARY));
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
    painter.setRenderHint(QPainter::Antialiasing);
    painter.drawPixmap(0, 0, pixmap);
    
    //  style message display
    if (!curMessage.isEmpty()) {
        QRect messageRect = rect().adjusted(50, 0, -50, -80);
        
        // Parse progress percentage from message if available
        QString displayMessage = curMessage;
        int progressPercent = -1;
        QRegExp progressRegex("(\\d+)%");
        if (progressRegex.indexIn(curMessage) != -1) {
            progressPercent = progressRegex.cap(1).toInt();
            // Clean up the message for display
            displayMessage = curMessage.section('\n', 0, 0); // Get first line only
        }
        
        //  style message text
        QFontDatabase fontDb;
        QFont messageFont("Inter", 14, QFont::Medium);
        if (!fontDb.families().contains("Inter")) {
            messageFont = QFont("SF Pro Display", 14, QFont::Medium);
            if (!fontDb.families().contains("SF Pro Display")) {
                messageFont = QFont("Segoe UI", 14, QFont::Medium);
            }
        }
        
        painter.setFont(messageFont);
        painter.setPen(QColor(255, 255, 255));  // White text for dark background
        
        // Draw message text centered above progress area
        QFontMetrics fm(messageFont);
        QString cleanMessage = displayMessage.split('\n')[0]; // First line only
        int messageWidth = fm.horizontalAdvance(cleanMessage);
        int messageX = (width() - messageWidth) / 2;
        int messageY = height() - 120;
        
        painter.drawText(messageX, messageY, cleanMessage);
        
        //  style dark progress bar
        if (progressPercent >= 0) {
            QRect progressBg(50, height() - 40, width() - 100, 20);
            QRect progressFill(50, height() - 40, (width() - 100) * progressPercent / 100, 20);
            
            // Dark background
            painter.setPen(QPen(QColor(71, 85, 105), 1));   // Dark border #475569
            painter.setBrush(QBrush(QColor(30, 41, 59)));    // Dark background #1E293B
            painter.drawRoundedRect(progressBg, 10, 10);
            
            // Progress fill with  colorful gradient
            if (progressPercent > 0) {
                QLinearGradient progressGradient(progressFill.left(), 0, progressFill.right(), 0);
                progressGradient.setColorAt(0, QColor(147, 51, 234));  // Purple #9333EA
                progressGradient.setColorAt(0.5, QColor(59, 130, 246)); // Blue #3B82F6
                progressGradient.setColorAt(1, QColor(34, 197, 94));   // Green #22C55E
                
                painter.setPen(Qt::NoPen);
                painter.setBrush(QBrush(progressGradient));
                painter.drawRoundedRect(progressFill, 10, 10);
                
                // Add subtle shine effect for modern look
                QLinearGradient shineGradient(0, progressFill.top(), 0, progressFill.bottom());
                shineGradient.setColorAt(0, QColor(255, 255, 255, 30));
                shineGradient.setColorAt(0.5, QColor(255, 255, 255, 15));
                shineGradient.setColorAt(1, QColor(255, 255, 255, 5));
                
                painter.setBrush(QBrush(shineGradient));
                painter.drawRoundedRect(progressFill, 10, 10);
            }
            
            // Progress percentage text
            QFont percentFont("Inter", 12, QFont::Medium);
            if (!fontDb.families().contains("Inter")) {
                percentFont = QFont("SF Pro Display", 12, QFont::Medium);
                if (!fontDb.families().contains("SF Pro Display")) {
                    percentFont = QFont("Segoe UI", 12, QFont::Medium);
                }
            }
            
            painter.setFont(percentFont);
            painter.setPen(QColor(148, 163, 184));  // Light gray #94A3B8
            QString percentText = QString("%1%").arg(progressPercent);
            QFontMetrics percentFm(percentFont);
            int percentWidth = percentFm.horizontalAdvance(percentText);
            painter.drawText((width() - percentWidth) / 2, height() - 50, percentText);
        }
    }
}

void SplashScreen::closeEvent(QCloseEvent *event)
{
    StartShutdown();
    event->ignore();
} 

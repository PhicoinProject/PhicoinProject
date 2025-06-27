/*
###############################################################################
#                                                                             #
# The MIT License                                                             #
#                                                                             #
# Copyright (C) 2017 by Juergen Skrotzky (JorgenVikingGod@gmail.com)          #
#               >> https://github.com/Jorgen-VikingGod                        #
#                                                                             #
# Sources: https://github.com/Jorgen-VikingGod/Qt-Frameless-Window-DarkStyle  #
#                                                                             #
###############################################################################
*/

#include <QDebug>
#include "darkstyle.h"

DarkStyle::DarkStyle():
  DarkStyle(styleBase())
{ }

DarkStyle::DarkStyle(QStyle *style):
  QProxyStyle(style)
{ }

QStyle *DarkStyle::styleBase(QStyle *style) const {
  static QStyle *base = !style ? QStyleFactory::create(QStringLiteral("Fusion")) : style;
  return base;
}

QStyle *DarkStyle::baseStyle() const
{
  return styleBase();
}

void DarkStyle::polish(QPalette &palette)
{
  //  inspired modern dark palette
  palette.setColor(QPalette::Window, QColor(15, 23, 42));        // #0F172A
  palette.setColor(QPalette::WindowText, QColor(241, 245, 249)); // #F1F5F9
  palette.setColor(QPalette::Disabled, QPalette::WindowText, QColor(100, 116, 139)); // #64748B
  palette.setColor(QPalette::Base, QColor(30, 41, 59));          // #1E293B
  palette.setColor(QPalette::AlternateBase, QColor(51, 65, 85)); // #334155
  palette.setColor(QPalette::ToolTipBase, QColor(31, 41, 55));   // #1F2937
  palette.setColor(QPalette::ToolTipText, QColor(255, 255, 255));
  palette.setColor(QPalette::Text, QColor(241, 245, 249));       // #F1F5F9
  palette.setColor(QPalette::Disabled, QPalette::Text, QColor(100, 116, 139)); // #64748B
  palette.setColor(QPalette::Dark, QColor(15, 23, 42));          // #0F172A
  palette.setColor(QPalette::Shadow, QColor(51, 65, 85));  // #334155 instead of black
  palette.setColor(QPalette::Button, QColor(51, 65, 85));        // #334155
  palette.setColor(QPalette::ButtonText, QColor(241, 245, 249)); // #F1F5F9
  palette.setColor(QPalette::Disabled, QPalette::ButtonText, QColor(100, 116, 139)); // #64748B
  palette.setColor(QPalette::BrightText, QColor(239, 68, 68));   // #EF4444 (Red for warnings)
  palette.setColor(QPalette::Link, QColor(59, 130, 246));        // #3B82F6 (Scale blue)
  palette.setColor(QPalette::Highlight, QColor(59, 130, 246));   // #3B82F6
  palette.setColor(QPalette::Disabled, QPalette::Highlight, QColor(71, 85, 105)); // #475569
  palette.setColor(QPalette::HighlightedText, QColor(255, 255, 255));
  palette.setColor(QPalette::Disabled, QPalette::HighlightedText, QColor(148, 163, 184)); // #94A3B8
}

void DarkStyle::polish(QApplication *app)
{
  if (!app) return;

  // Load darkstyle directly instead of trying scalestyle first
  QFile qfDarkstyle(QStringLiteral(":/scalestyle/qss"));
  if (qfDarkstyle.open(QIODevice::ReadOnly | QIODevice::Text))
  {
    QString qsStylesheet = QString::fromLatin1(qfDarkstyle.readAll());
    app->setStyleSheet(qsStylesheet);
    qfDarkstyle.close();
  }
}

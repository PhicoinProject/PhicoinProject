// Copyright (c) 2011-2014 The Bitcoin Core developers
// Copyright (c) @2024 The PHICOIN Core developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#ifndef PHICOIN_QT_PHICOINADDRESSVALIDATOR_H
#define PHICOIN_QT_PHICOINADDRESSVALIDATOR_H

#include <QValidator>

/** Base58 entry widget validator, checks for valid characters and
 * removes some whitespace.
 */
class PHICOINAddressEntryValidator : public QValidator
{
    Q_OBJECT

public:
    explicit PHICOINAddressEntryValidator(QObject *parent);

    State validate(QString &input, int &pos) const;
};

/** PHICOIN address widget validator, checks for a valid phicoin address.
 */
class PHICOINAddressCheckValidator : public QValidator
{
    Q_OBJECT

public:
    explicit PHICOINAddressCheckValidator(QObject *parent);

    State validate(QString &input, int &pos) const;
};

#endif // PHICOIN_QT_PHICOINADDRESSVALIDATOR_H

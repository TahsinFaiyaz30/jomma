package com.jomma.notifier.data

/**
 * Deciding which watched number a message belongs to.
 *
 * With one pairing this question did not exist. With several it has to be
 * answered at the moment of capture, because everything that could answer it —
 * the app that posted the notification, the sender name, the SIM it arrived on
 * — is gone by the time the queue is flushed.
 *
 * Getting it wrong is not a display bug. A capture posted under the wrong
 * pairing is one merchant's payment arriving in another's feed, so every path
 * here fails closed: no confident answer means no capture, which shows up as a
 * missing payment somebody chases, rather than a wrong one nobody does.
 */
object Attribution {

    /** Provider app package names, so a notification names its own provider. */
    private val PACKAGE_PROVIDERS = mapOf(
        "com.bKash.customerapp" to "bkash",
        "com.konasl.nagad" to "nagad",
    )

    /**
     * Sender ids as they appear on an SMS.
     *
     * Matched case-insensitively and by prefix, because operators append
     * suffixes and the exact string varies between carriers.
     */
    private val SENDER_PROVIDERS = mapOf(
        "bkash" to "bkash",
        "nagad" to "nagad",
    )

    fun providerForPackage(pkg: String?): String? = PACKAGE_PROVIDERS[pkg]

    fun providerForSender(sender: String?): String? {
        val normalised = sender?.lowercase()?.filter { it.isLetter() } ?: return null
        return SENDER_PROVIDERS.entries.firstOrNull { normalised.contains(it.key) }?.value
    }

    /**
     * The pairing a notification belongs to.
     *
     * By provider, which is enough: a phone runs one bKash account and one Nagad
     * account, because each app holds a single logged-in number. Two pairings
     * for the same provider on one phone therefore means two SIMs, and a
     * notification cannot say which SIM it relates to — so that case is refused
     * rather than guessed.
     */
    fun forNotification(pairings: List<Pairing>, pkg: String?): Pairing? {
        val provider = providerForPackage(pkg) ?: return null
        val candidates = pairings.filter { it.live && it.provider == provider }
        return candidates.singleOrNull()
    }

    /**
     * The pairing an SMS belongs to.
     *
     * The subscription id is tried first and is the only thing that can separate
     * two accounts with the same provider on one phone — which is exactly why
     * the settings screen asks for it, and only asks when there is an ambiguity
     * to resolve.
     *
     * Falling back to the sender covers the ordinary case, where the SIM is
     * irrelevant because only one pairing could have received it.
     */
    fun forSms(pairings: List<Pairing>, sender: String?, subscriptionId: Int?): Pairing? {
        val live = pairings.filter { it.live }

        if (subscriptionId != null && subscriptionId >= 0) {
            live.firstOrNull { it.subscriptionId == subscriptionId }?.let { return it }
        }

        val provider = providerForSender(sender) ?: return null
        return live.filter { it.provider == provider }.singleOrNull()
    }

    /**
     * Whether two pairings are indistinguishable without a SIM to tell them
     * apart, so the settings screen knows to ask.
     */
    fun needsSubscriptionId(pairings: List<Pairing>, pairing: Pairing): Boolean =
        pairing.subscriptionId == null &&
            pairings.count { it.provider == pairing.provider && it.deviceId != pairing.deviceId } > 0
}

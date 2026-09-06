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
     * By provider, and it cannot be better than that. A notification is posted
     * by the provider's app, and the app says which provider it is and nothing
     * else — not which SIM, not which account. Where an SMS carries the
     * subscription it arrived on, this carries nothing to tell two bKash
     * accounts apart, so two live bKash pairings mean the message is refused
     * rather than assigned to whichever sorts first.
     *
     * Refusing is not a gap left unfilled. It is the case where the provider's
     * own app is logged into one of the two accounts and the notification is
     * only ever about that one — but nothing on the phone can say which, and
     * guessing puts one merchant's payment in another merchant's feed.
     *
     * The second capture path covers it: SMS arrives with a subscription id,
     * that binds to a SIM, and the SIM identifies the account. Two accounts of
     * the same provider on one phone are therefore watched over SMS, which is
     * why adding one now asks which SIM it is on.
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
    fun forSms(
        pairings: List<Pairing>,
        sender: String?,
        subscriptionId: Int?,
        /**
         * The SIMs in the phone right now, so a binding can be re-checked
         * against reality. Empty means "could not look" — the permission is
         * missing or the read failed — which is treated as unverified rather
         * than as verified-false, so an existing setup keeps working when the
         * app is upgraded before the permission is granted.
         */
        sims: List<SimCard> = emptyList(),
    ): Pairing? {
        val live = pairings.filter { it.live }

        if (subscriptionId != null && subscriptionId >= 0) {
            val bound = live.firstOrNull { it.subscriptionId == subscriptionId }
            if (bound != null) return bound.takeIf { stillTheSameSim(it, sims) }
        }

        val provider = providerForSender(sender) ?: return null
        return live.filter { it.provider == provider }.singleOrNull()
    }

    /**
     * Whether the SIM behind a pairing's subscription is still the one it was
     * bound to.
     *
     * A subscription id identifies a *slot's current SIM*, and Android hands the
     * same id back out when a different SIM takes that place. Trusting the id
     * alone means a SIM swap silently re-points an account: messages from
     * whoever owns the new SIM would be captured and posted under the old
     * account's credential, which is somebody else's money in a merchant's
     * feed.
     *
     * Comparing the number closes that. It only refuses when it can positively
     * tell they differ — an unreadable SIM or a pairing from before this
     * existed is let through, because breaking every working phone to defend
     * against a swap that has not happened is the worse failure.
     */
    private fun stillTheSameSim(pairing: Pairing, sims: List<SimCard>): Boolean {
        val expected = pairing.simMsisdn ?: return true
        val actual = sims.firstOrNull { it.subscriptionId == pairing.subscriptionId }
            ?: return true
        val reported = actual.msisdn ?: return true
        return reported == expected
    }

    /**
     * Whether two pairings are indistinguishable without a SIM to tell them
     * apart, so the settings screen knows to ask.
     */
    fun needsSubscriptionId(pairings: List<Pairing>, pairing: Pairing): Boolean =
        pairing.subscriptionId == null &&
            pairings.count { it.provider == pairing.provider && it.deviceId != pairing.deviceId } > 0
}

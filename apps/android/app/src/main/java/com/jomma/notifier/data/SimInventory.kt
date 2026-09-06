package com.jomma.notifier.data

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.SubscriptionInfo
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.serialization.Serializable

/**
 * The SIMs in this phone, and which number each one is.
 *
 * Exists so that adding an account stops being a typing exercise. The operator
 * used to key the bKash number into the dashboard, and the phone was told which
 * SIM it was on as a separate, later step — two facts entered by hand that had
 * to agree, with nothing checking that they did. Getting them out of step meant
 * messages routed to the wrong account, or to none.
 *
 * ## What Android will and will not tell us
 *
 * The slot, the carrier and the subscription id are reliable. The **number** is
 * not: it lives in a file on the SIM that the carrier has to have written, and
 * plenty never do. There is no API that can invent it, so this reports what it
 * found and from where, and a SIM whose number nobody knows is offered as
 * unusable rather than as a blank to fill in.
 *
 * Four sources are tried, best first, because they fail independently:
 *
 *  - **UICC** — the SIM itself. Right when present, absent on many carriers.
 *  - **CARRIER** — what the carrier's own config reports, which can be right
 *    when the SIM is silent.
 *  - **IMS** — the number the network registered for calling, which exists
 *    whenever VoLTE is up. Often the only source that answers on a modern
 *    Bangladeshi SIM.
 *  - **line1** — the pre-Android-13 path, kept because `minSdk` is 26.
 *
 * The ICCID would have been the ideal stable identity for a SIM and is not
 * available: Android has restricted it to privileged apps since 10. Subscription
 * id is the substitute — the platform keys it to the SIM internally, so a
 * different SIM in the same slot gets a different id, which is what makes swap
 * detection work at all.
 */
@Serializable
data class SimCard(
    /** Android's handle for this SIM. Changes when a different SIM is inserted. */
    val subscriptionId: Int,
    /** Physical slot, 0-based. What the phone's own settings call SIM 1 / SIM 2. */
    val slotIndex: Int,
    val carrierName: String,
    /** The user-visible label, which they may have renamed. */
    val displayName: String,
    /** Canonical `8801XXXXXXXXX`, or null when nothing would say. */
    val msisdn: String?,
    /** Which of the four sources answered. Null when none did. */
    val numberSource: String?,
    /** `2G` | `3G` | `4G` | `5G` | `unknown` — shown so a SIM is recognisable. */
    val networkGeneration: String,
) {
    /** Only a SIM whose number is known can be bound to an account. */
    val usable: Boolean get() = msisdn != null

    /** The shape the server accepts. See `SimReport` for why it is separate. */
    fun toReport() = com.jomma.notifier.net.SimReport(
        subscriptionId = subscriptionId,
        slotIndex = slotIndex,
        carrierName = carrierName,
        displayName = displayName,
        msisdn = msisdn,
        numberSource = numberSource,
        networkGeneration = networkGeneration,
    )
}

object SimInventory {

    private const val TAG = "JommaSim"

    /** Matches the server's `canonicalMsisdn`, so both sides agree on one form. */
    fun canonicalise(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        val digits = raw.filter { it.isDigit() }
        val local = if (digits.startsWith("880")) digits.removePrefix("880") else digits
        val withZero = if (local.startsWith("0")) local else "0$local"
        return if (Regex("^01[3-9]\\d{8}$").matches(withZero)) "880${withZero.drop(1)}" else null
    }

    /** Whether the permissions this needs have been granted. */
    fun hasPermission(context: Context): Boolean {
        val phoneState = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.READ_PHONE_STATE,
        ) == PackageManager.PERMISSION_GRANTED

        // READ_PHONE_NUMBERS exists from API 26 and is what the number sources
        // want on 33+. READ_SMS also satisfies them and is already held, so this
        // is belt and braces rather than a hard requirement.
        val numbers = Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.READ_PHONE_NUMBERS,
            ) == PackageManager.PERMISSION_GRANTED

        return phoneState && numbers
    }

    /** The permissions to ask for. */
    val permissions: Array<String> = arrayOf(
        Manifest.permission.READ_PHONE_STATE,
        Manifest.permission.READ_PHONE_NUMBERS,
    )

    /**
     * Every active SIM, with whatever could be learned about it.
     *
     * Empty when the permission has not been granted or the phone has no SIM —
     * both are ordinary states, not errors, and the screen says which.
     */
    fun read(context: Context): List<SimCard> {
        if (!hasPermission(context)) return emptyList()

        val subscriptions = context.getSystemService(SubscriptionManager::class.java)
            ?: return emptyList()

        val active = runCatching { subscriptions.activeSubscriptionInfoList }
            .getOrElse {
                Log.w(TAG, "could not list subscriptions", it)
                null
            }
            ?: return emptyList()

        return active.map { info -> describe(context, subscriptions, info) }
            .sortedBy { it.slotIndex }
    }

    private fun describe(
        context: Context,
        subscriptions: SubscriptionManager,
        info: SubscriptionInfo,
    ): SimCard {
        val (msisdn, source) = detectNumber(context, subscriptions, info)

        return SimCard(
            subscriptionId = info.subscriptionId,
            slotIndex = info.simSlotIndex,
            carrierName = info.carrierName?.toString().orEmpty(),
            displayName = info.displayName?.toString().orEmpty(),
            msisdn = msisdn,
            numberSource = source,
            networkGeneration = networkGeneration(context, info.subscriptionId),
        )
    }

    /**
     * The SIM's own number, from whichever source will admit to it.
     *
     * Ordered by how much each is worth trusting rather than by convenience. The
     * source is returned alongside because "we think this SIM is 017…, according
     * to the carrier" is a different claim from "the SIM says so", and the
     * screen showing it should be able to say which.
     */
    private fun detectNumber(
        context: Context,
        subscriptions: SubscriptionManager,
        info: SubscriptionInfo,
    ): Pair<String?, String?> {
        val subId = info.subscriptionId

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val sources = listOf(
                SubscriptionManager.PHONE_NUMBER_SOURCE_UICC to "sim",
                SubscriptionManager.PHONE_NUMBER_SOURCE_CARRIER to "carrier",
                SubscriptionManager.PHONE_NUMBER_SOURCE_IMS to "ims",
            )
            for ((source, label) in sources) {
                val raw = runCatching { subscriptions.getPhoneNumber(subId, source) }.getOrNull()
                val found = canonicalise(raw)

                /*
                 * Whether each source answered, never what it said. Which
                 * sources work is carrier-specific and the first thing worth
                 * knowing when a SIM will not resolve on somebody's phone; the
                 * number itself is the operator's and does not belong in a log.
                 */
                Log.i(
                    TAG,
                    "sub $subId source=$label answered=${!raw.isNullOrBlank()} usable=${found != null}",
                )
                if (found != null) return found to label
            }
        }

        // Pre-33, and as a last try above it: the number carried on the
        // subscription record, then the legacy line-1 lookup.
        @Suppress("DEPRECATION")
        canonicalise(runCatching { info.number }.getOrNull())?.let { return it to "sim" }

        val telephony = context.getSystemService(TelephonyManager::class.java)
            ?.let { runCatching { it.createForSubscriptionId(subId) }.getOrNull() }

        @Suppress("DEPRECATION")
        canonicalise(runCatching { telephony?.line1Number }.getOrNull())
            ?.let { return it to "line1" }

        return null to null
    }

    /**
     * 2G / 3G / 4G / 5G, so a SIM is recognisable in a list.
     *
     * Cosmetic — nothing routes on it. Two SIMs from the same carrier with no
     * number between them are otherwise two identical rows, and somebody has to
     * pick one.
     */
    private fun networkGeneration(context: Context, subId: Int): String {
        val telephony = context.getSystemService(TelephonyManager::class.java)
            ?.let { runCatching { it.createForSubscriptionId(subId) }.getOrNull() }
            ?: return "unknown"

        val type = runCatching { telephony.dataNetworkType }.getOrElse {
            return "unknown"
        }

        return when (type) {
            TelephonyManager.NETWORK_TYPE_GPRS,
            TelephonyManager.NETWORK_TYPE_EDGE,
            TelephonyManager.NETWORK_TYPE_CDMA,
            TelephonyManager.NETWORK_TYPE_1xRTT,
            TelephonyManager.NETWORK_TYPE_IDEN,
            TelephonyManager.NETWORK_TYPE_GSM,
            -> "2G"

            TelephonyManager.NETWORK_TYPE_UMTS,
            TelephonyManager.NETWORK_TYPE_EVDO_0,
            TelephonyManager.NETWORK_TYPE_EVDO_A,
            TelephonyManager.NETWORK_TYPE_HSDPA,
            TelephonyManager.NETWORK_TYPE_HSUPA,
            TelephonyManager.NETWORK_TYPE_HSPA,
            TelephonyManager.NETWORK_TYPE_EVDO_B,
            TelephonyManager.NETWORK_TYPE_EHRPD,
            TelephonyManager.NETWORK_TYPE_HSPAP,
            TelephonyManager.NETWORK_TYPE_TD_SCDMA,
            -> "3G"

            TelephonyManager.NETWORK_TYPE_LTE,
            TelephonyManager.NETWORK_TYPE_IWLAN,
            -> "4G"

            TelephonyManager.NETWORK_TYPE_NR -> "5G"
            else -> "unknown"
        }
    }
}

package com.glink25.tio

import android.content.Context
import androidx.work.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import java.util.concurrent.TimeUnit

class SyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        return try {
            if (NativeKernel.needsRetry(applicationContext) { isStopped }) Result.retry() else Result.success()
        } catch (error: TimeoutCancellationException) {
            if (isStopped) throw error
            Result.retry()
        } catch (error: CancellationException) {
            throw error
        } catch (error: NativeKernel.Failure) {
            if (error.code != "pending") android.util.Log.w("TioSync", "Kernel unavailable", error)
            Result.retry()
        } catch (error: Exception) {
            android.util.Log.w("TioSync", "Background execution failed", error)
            Result.retry()
        }
    }

    companion object {
        fun request(context: Context) {
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("tio-sync-now", ExistingWorkPolicy.REPLACE, request)
        }

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "tio-sync", ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}

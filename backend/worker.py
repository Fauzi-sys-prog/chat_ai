import time

from main import EMAIL_JOB_POLL_SECONDS, process_pending_email_jobs


def main() -> None:
    while True:
        process_pending_email_jobs(worker_name="standalone-worker")
        time.sleep(max(EMAIL_JOB_POLL_SECONDS, 5))


if __name__ == "__main__":
    main()

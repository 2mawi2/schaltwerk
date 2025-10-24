use std::sync::Mutex;

static ENV_LOCK: Mutex<()> = Mutex::new(());

pub struct EnvAdapter;

impl EnvAdapter {
    pub fn set_var(key: &str, value: &str) {
        let _guard = ENV_LOCK.lock().expect("env adapter mutex poisoned");
        unsafe {
            std::env::set_var(key, value);
        }
    }

    pub fn remove_var(key: &str) {
        let _guard = ENV_LOCK.lock().expect("env adapter mutex poisoned");
        unsafe {
            std::env::remove_var(key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_set_and_remove_var() {
        let key = "SCHALTWERK_TEST_ENV_ADAPTER";
        let value = "test_value";

        EnvAdapter::set_var(key, value);
        assert_eq!(std::env::var(key).unwrap(), value);

        EnvAdapter::remove_var(key);
        assert!(std::env::var(key).is_err());
    }

    #[test]
    fn test_set_var_overwrites() {
        let key = "SCHALTWERK_TEST_ENV_ADAPTER_OVERWRITE";

        EnvAdapter::set_var(key, "first");
        assert_eq!(std::env::var(key).unwrap(), "first");

        EnvAdapter::set_var(key, "second");
        assert_eq!(std::env::var(key).unwrap(), "second");

        EnvAdapter::remove_var(key);
    }
}

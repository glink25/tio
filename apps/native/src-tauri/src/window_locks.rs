use std::{collections::HashMap, fs::File, sync::Mutex};

#[derive(Default)]
pub struct WindowLocks(Mutex<LockState>);

#[derive(Default)]
struct LockState {
    generations: HashMap<String, u64>,
    held: HashMap<String, (String, File)>,
}

impl WindowLocks {
    pub fn owner(&self, label: &str) -> Result<String, &'static str> {
        let state = self.0.lock().map_err(|_| "unavailable")?;
        Ok(format!(
            "{label}:{}",
            state.generations.get(label).copied().unwrap_or(0)
        ))
    }

    pub fn check(&self, label: &str, owner: &str) -> Result<(), &'static str> {
        if self.owner(label)? == owner {
            Ok(())
        } else {
            Err("closed")
        }
    }

    pub fn renew(&self, label: &str) -> Option<String> {
        let mut state = self.0.lock().ok()?;
        let generation = state.generations.entry(label.into()).or_default();
        let owner = format!("{label}:{generation}");
        *generation += 1;
        state.held.retain(|_, (current, _)| current != &owner);
        Some(owner)
    }

    pub fn hold(&self, label: &str, owner: String, file: File) -> Result<String, &'static str> {
        let mut state = self.0.lock().map_err(|_| "unavailable")?;
        let generation = state.generations.get(label).copied().unwrap_or(0);
        if owner != format!("{label}:{generation}") {
            return Err("closed");
        }
        let token = uuid::Uuid::new_v4().to_string();
        state.held.insert(token.clone(), (owner, file));
        Ok(token)
    }

    pub fn release(&self, owner: &str, token: &str) -> Result<(), &'static str> {
        let mut state = self.0.lock().map_err(|_| "unavailable")?;
        if state
            .held
            .get(token)
            .is_some_and(|(current, _)| current == owner)
        {
            state.held.remove(token);
        }
        Ok(())
    }

    pub fn reset(&self) {
        if let Ok(mut state) = self.0.lock() {
            state.held.clear();
        }
    }
}

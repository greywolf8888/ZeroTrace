//! Campaign partition. Change points are candidates; every event belongs to one window.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SeriesPoint {
    pub index: usize,
    pub value: f64,
}

pub fn detect_change_points(values: &[f64], penalty: f64) -> Vec<usize> {
    let n = values.len();
    if n < 4 {
        return Vec::new();
    }
    let mut prefix = vec![0.0; n + 1];
    let mut prefix_sq = vec![0.0; n + 1];
    for i in 0..n {
        prefix[i + 1] = prefix[i] + values[i];
        prefix_sq[i + 1] = prefix_sq[i] + values[i] * values[i];
    }
    let cost = |start: usize, end: usize| -> f64 {
        let len = (end - start) as f64;
        if len <= 0.0 {
            return 0.0;
        }
        let sum = prefix[end] - prefix[start];
        let sum_sq = prefix_sq[end] - prefix_sq[start];
        let mean = sum / len;
        sum_sq - len * mean * mean
    };
    let mut f = vec![f64::INFINITY; n + 1];
    let mut prev = vec![0usize; n + 1];
    f[0] = -penalty;
    for end in 1..=n {
        for start in 0..end {
            let candidate = f[start] + cost(start, end) + penalty;
            if candidate < f[end] {
                f[end] = candidate;
                prev[end] = start;
            }
        }
    }
    let mut points = Vec::new();
    let mut cursor = n;
    while cursor > 0 {
        let start = prev[cursor];
        if start > 0 {
            points.push(start);
        }
        cursor = start;
    }
    points.reverse();
    points
}

/// Online BOCPD hazard using a simple Gaussian residual run-length posterior.
pub fn bocpd_change_probs(values: &[f64], hazard: f64) -> Vec<f64> {
    if values.is_empty() {
        return Vec::new();
    }
    let mut probs = Vec::with_capacity(values.len());
    let mut run = 1.0;
    let mut mean = values[0];
    probs.push(0.0);
    for &value in values.iter().skip(1) {
        let residual = (value - mean).abs();
        let growth = (1.0 - hazard) * (-residual).exp();
        let cp = hazard / (hazard + growth);
        probs.push(cp);
        run = 1.0 + run * (1.0 - cp);
        mean = (mean * (run - 1.0) + value) / run;
    }
    probs
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TacticObservation {
    pub families: u32,
    pub evidence_for: u32,
    pub alternatives_excluded: bool,
    pub single_factor_only: bool,
}

pub fn evaluate_tactic(observation: &TacticObservation) -> bool {
    if observation.single_factor_only {
        return false;
    }
    if observation.families < 2 {
        return false;
    }
    if !observation.alternatives_excluded {
        return false;
    }
    observation.evidence_for > 0
}

pub fn complete_partition(len: usize, change_points: &[usize]) -> Vec<(usize, usize)> {
    let mut bounds = vec![0usize];
    bounds.extend(change_points.iter().copied().filter(|index| *index < len));
    bounds.push(len);
    bounds.dedup();
    bounds.windows(2).map(|pair| (pair[0], pair[1])).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pelt_finds_mean_shift() {
        let mut values = vec![0.0; 20];
        values.extend(std::iter::repeat(10.0).take(20));
        let points = detect_change_points(&values, 3.0);
        assert!(points.iter().any(|index| (15..=25).contains(index)));
    }

    #[test]
    fn partition_covers_without_overlap() {
        let parts = complete_partition(10, &[4, 7]);
        assert_eq!(parts, vec![(0, 4), (4, 7), (7, 10)]);
        assert_eq!(parts.last().unwrap().1, 10);
    }

    #[test]
    fn tactic_requires_two_families() {
        assert!(!evaluate_tactic(&TacticObservation {
            families: 1,
            evidence_for: 3,
            alternatives_excluded: true,
            single_factor_only: false,
        }));
    }
}

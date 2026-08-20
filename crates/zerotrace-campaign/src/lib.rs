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
    let mut candidates = vec![0usize];
    for end in 1..=n {
        for &start in &candidates {
            let candidate = f[start] + cost(start, end) + penalty;
            if candidate < f[end] {
                f[end] = candidate;
                prev[end] = start;
            }
        }
        candidates.retain(|&start| f[start] + cost(start, end) <= f[end] + f64::EPSILON);
        candidates.push(end);
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

fn gaussian_log_pdf(value: f64, mean: f64, variance: f64) -> f64 {
    let safe_variance = variance.max(f64::EPSILON);
    -0.5 * ((2.0 * std::f64::consts::PI * safe_variance).ln()
        + (value - mean).powi(2) / safe_variance)
}

fn update_gaussian_mean(
    prior_mean: f64,
    prior_variance: f64,
    value: f64,
    observation_variance: f64,
) -> (f64, f64) {
    let precision = prior_variance.recip() + observation_variance.recip();
    let posterior_variance = precision.recip();
    let posterior_mean =
        posterior_variance * (prior_mean / prior_variance + value / observation_variance);
    (posterior_mean, posterior_variance)
}

/// Bayesian online change-point detection with an explicit run-length posterior.
///
/// The observation model is Gaussian with known variance and a Gaussian prior over the segment
/// mean. A change-point transition starts a new segment from that prior; growth transitions update
/// each existing run independently. The returned row at time `t` contains `P(r_t = r | x_1:t)`.
pub fn bocpd_run_length_posterior(values: &[f64], hazard: f64) -> Vec<Vec<f64>> {
    if values.is_empty() {
        return Vec::new();
    }
    let bounded_hazard = hazard.clamp(1e-9, 1.0 - 1e-9);
    let prior_mean = values[0];
    let scale = (values[0].abs() * 0.1).max(1.0);
    let observation_variance = scale * scale;
    let prior_variance = observation_variance * 100.0;
    let mut run_probabilities = vec![1.0f64];
    let mut means = vec![prior_mean];
    let mut mean_variances = vec![prior_variance];
    let mut posterior_rows = Vec::with_capacity(values.len());

    for &value in values {
        if !value.is_finite() {
            posterior_rows.push(vec![1.0]);
            run_probabilities = vec![1.0];
            means = vec![prior_mean];
            mean_variances = vec![prior_variance];
            continue;
        }

        let mut log_joint = Vec::with_capacity(run_probabilities.len() + 1);
        log_joint.push(
            bounded_hazard.ln()
                + gaussian_log_pdf(value, prior_mean, observation_variance + prior_variance),
        );
        for ((probability, mean), mean_variance) in run_probabilities
            .iter()
            .zip(means.iter())
            .zip(mean_variances.iter())
        {
            log_joint.push(
                probability.max(f64::MIN_POSITIVE).ln()
                    + (1.0 - bounded_hazard).ln()
                    + gaussian_log_pdf(value, *mean, observation_variance + *mean_variance),
            );
        }
        let max_log = log_joint.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let mut next_probabilities = log_joint
            .iter()
            .map(|joint| (*joint - max_log).exp())
            .collect::<Vec<_>>();
        let normalizer = next_probabilities.iter().sum::<f64>();
        for probability in &mut next_probabilities {
            *probability /= normalizer;
        }

        let mut next_means = Vec::with_capacity(means.len() + 1);
        let mut next_variances = Vec::with_capacity(mean_variances.len() + 1);
        let (change_mean, change_variance) =
            update_gaussian_mean(prior_mean, prior_variance, value, observation_variance);
        next_means.push(change_mean);
        next_variances.push(change_variance);
        for (&mean, &variance) in means.iter().zip(mean_variances.iter()) {
            let (updated_mean, updated_variance) =
                update_gaussian_mean(mean, variance, value, observation_variance);
            next_means.push(updated_mean);
            next_variances.push(updated_variance);
        }

        posterior_rows.push(next_probabilities.clone());
        run_probabilities = next_probabilities;
        means = next_means;
        mean_variances = next_variances;
    }
    posterior_rows
}

pub fn bocpd_change_probs(values: &[f64], hazard: f64) -> Vec<f64> {
    bocpd_run_length_posterior(values, hazard)
        .into_iter()
        .map(|row| row[0])
        .collect()
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
    fn pelt_matches_the_standard_multi_change_reference() {
        let values = [0.0, 0.1, -0.1, 8.0, 8.1, 7.9, -4.0, -4.1, -3.9];
        assert_eq!(detect_change_points(&values, 2.0), vec![3, 6]);
    }

    #[test]
    fn bocpd_returns_normalized_run_length_rows_and_resets_on_a_shift() {
        let mut values = vec![0.0; 20];
        values.extend(std::iter::repeat(10.0).take(10));
        let posterior = bocpd_run_length_posterior(&values, 0.02);
        assert_eq!(posterior.len(), values.len());
        for row in &posterior {
            assert!((row.iter().sum::<f64>() - 1.0).abs() < 1e-9);
        }
        assert!(posterior[20][0] > 0.5);
        assert!(bocpd_change_probs(&values, 0.02)[20] > 0.5);
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

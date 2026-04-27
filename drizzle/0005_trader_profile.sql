ALTER TABLE `userPreferences`
  ADD `maxDailyLoss` decimal(15,2),
  ADD `tradingStyle` enum('scalper','day_trader','swing_trader','position_trader','options_trader') DEFAULT 'day_trader',
  ADD `experienceLevel` enum('beginner','intermediate','advanced','professional') DEFAULT 'intermediate',
  ADD `mainWeakness` varchar(255),
  ADD `primaryGoal` varchar(255),
  ADD `favoriteTickers` text,
  ADD `coachStrictness` enum('gentle','balanced','strict') DEFAULT 'balanced';

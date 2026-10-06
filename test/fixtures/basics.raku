#!/usr/bin/env raku
# Written for this repository as a smoke test. It only uses syntax the
# grammar supports so far, and has to parse without error nodes.
use v6.d;

unit module Inventory;

#| A single line in the stock list.
class Item is export {
    has Str:D $.name is required;
    has Int $.count is rw = 0;
    has Rat $!unit-price;

    submethod BUILD(:$!name, :$!count = 0, :$price = 1.5) {
        $!unit-price = $price.Rat;
    }

    method total(--> Rat) { $!unit-price * $!count }

    method restock(Int $by where * > 0) {
        $!count += $by;
        self
    }

    method !label { "{$!name} x $!count" }

    method gist { "Item({self!label}, total {self.total})" }
}

role Countable {
    method next { self.count + 1 }
    method default { 0 }
}

enum Status;
subset Positive of Int where * > 0;
constant MAX-ITEMS = 1_000;

sub is-low(Item $item, Int :$threshold = 5 --> Bool) is export {
    $item.count < $threshold
}

multi sub describe(Item:D $item) { $item.gist }
multi sub describe(Any:U $) { 'nothing' }

#`(
  An embedded comment, with (nested) brackets,
  that spans several lines.
)
sub report(@items, :$out = $*OUT) {
    for @items -> $item {
        next unless $item.defined;
        if is-low($item) {
            $out.say("LOW  {$item.name}: only {$item.count} left");
        } elsif $item.count > MAX-ITEMS {
            $out.say("HIGH $item.name()");
        } else {
            $out.say: describe($item);
        }
    }
    my %totals = @items.map({ .name => .total });
    my $sum = [+] %totals.values;
    my @sorted = @items.sort({ $^a.total <=> $^b.total });
    return $sum ≤ 0 ?? Nil !! $sum, @sorted;
}

my @stock = Item.new(:name('bolt'), :count(3), :price(0.25)),
            Item.new(name => 'nut', count => 0x10),
            Item.new(:name("washer\t(small)"), :!count);

given @stock.elems {
    when 0 { say 'empty' }
    when 1..3 { say "a few: @stock.elems()" }
    default { say 'plenty' }
}

try {
    report(@stock);
    CATCH {
        default { note "failed: $_" }
    }
}

END { say 'done' }
